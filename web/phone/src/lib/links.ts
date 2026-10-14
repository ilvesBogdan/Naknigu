// Проверка ссылок статьи: какую из них получится открыть на книге как статью.
// Книга по этой отметке решает, предлагать ли «Открыть как статью».
import { isProbablyReaderable } from "@mozilla/readability";
import { CodedError, fetchPage } from "../../../shared/api";
import { decodePage } from "./charset";
import { habrId } from "./url";

/** Отметка на ссылке, которую как статью не открыть. */
export const PLAIN = "data-plain";

/** Сколько всего ждём проверку: дольше держать читателя незачем. */
const BUDGET_MS = 8000;
/** Сколько ждём одну страницу. */
const PAGE_MS = 6000;
/** Сколько страниц проверяем одновременно. */
const PARALLEL = 6;
/** Больше ссылок не скачиваем: остальные остаются непроверенными. */
const MAX_PAGES = 30;

/** Файлы, а не страницы: статьи в них заведомо нет. */
const FILES = /\.(pdf|zip|gz|tar|rar|7z|png|jpe?g|gif|webp|svg|mp[34]|avi|mov|exe|dmg|apk|docx?|xlsx?|pptx?)$/i;

/** Можно ли сказать по одному адресу, статья ли это; null — надо скачивать. */
export function guessByUrl(url: string): boolean | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol) || FILES.test(parsed.pathname)) {
    return false;
  }
  // Статьи Habr берутся из его API и всегда открываются.
  return habrId(url) ? true : null;
}

/** Ответы сервера, после которых ясно, что статьи по ссылке нет. */
const NOT_A_PAGE = [400, 403, 415]; // bad_url, private_address, not_html

/**
 * Скачивает страницу через сервер и спрашивает Readability, есть ли на ней
 * статья. null — узнать не удалось: сайт не ответил, ответил ошибкой или
 * отказал (так сайты встречают и частые запросы) — это не значит, что
 * статьи там нет.
 */
async function isArticle(url: string): Promise<boolean | null> {
  let response: Response;
  try {
    response = await fetchPage(url, PAGE_MS);
  } catch (error) {
    return error instanceof CodedError && NOT_A_PAGE.includes(Number(error.args.status)) ? false : null;
  }
  const page = decodePage(response.headers.get("Content-Type"), new Uint8Array(await response.arrayBuffer()));
  return isProbablyReaderable(new DOMParser().parseFromString(page, "text/html"));
}

/**
 * Ставит отметку PLAIN на ссылки, которые как статью не открыть. Ссылки,
 * которые не успели проверить за BUDGET_MS, остаются без отметки: лучше
 * предложить лишнее, чем спрятать рабочее.
 */
export async function markLinks(html: string): Promise<string> {
  // Отдельный документ: разметка статьи не должна ничего скачивать и исполнять.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const anchors = Array.from(doc.body.querySelectorAll("a[href]"));
  const verdicts = new Map<string, boolean>();
  const queue: string[] = [];
  // Адреса сравниваем без части после «#»: это одна и та же страница.
  const pageOf = (a: Element) => (a.getAttribute("href") ?? "").split("#")[0];
  for (const a of anchors) {
    const url = pageOf(a);
    if (!verdicts.has(url) && !queue.includes(url)) {
      const guess = guessByUrl(url);
      if (guess === null) {
        queue.push(url);
      } else {
        verdicts.set(url, guess);
      }
    }
  }

  queue.length = Math.min(queue.length, MAX_PAGES);

  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      // Сеть подвела — не знаем, статья ли это; отметку не ставим.
      const verdict = await isArticle(url).catch(() => null);
      if (verdict !== null) {
        verdicts.set(url, verdict);
      }
    }
  };
  const all = Promise.all(Array.from({ length: PARALLEL }, worker));
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, BUDGET_MS))]);
  queue.length = 0; // время вышло: оставшиеся страницы не скачиваем

  for (const a of anchors) {
    if (verdicts.get(pageOf(a)) === false) {
      a.setAttribute(PLAIN, "");
    }
  }
  return doc.body.innerHTML;
}
