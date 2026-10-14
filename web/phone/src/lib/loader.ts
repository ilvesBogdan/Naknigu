// Загрузка статьи: получить страницу и превратить её в режим чтения.
//
// Режим чтения делает Readability.js — алгоритм из Firefox. Страницу Habr
// телефон берёт напрямую из его JSON API (у него открыт CORS), страницы
// остальных сайтов скачивает наш сервер: чужому браузеру сайты их не отдают.
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { CodedError, fetchPage, request } from "../../../shared/api";
import type { Article } from "../../../shared/protocol";
import { decodePage } from "./charset";
import { markLinks } from "./links";
import { habrId, smallImageUrl } from "./url";

/** Сообщает о шаге загрузки; key — ключ словаря `status.*`. */
export type OnStatus = (key: string) => void;

/** Около 1200 знаков в минуту. */
const CHARS_PER_MINUTE = 1200;

/** Сайты нередко разбивают имя автора и дату переводами строк — склеиваем. */
function oneLine(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

interface Distilled {
  title: string;
  byline: string;
  siteName: string;
  published: string;
  lang: string;
  minutes: number;
  html: string;
}

/**
 * Прогоняет страницу через Readability и облегчает разметку для e-ink.
 * mustBeReaderable включает проверку «похожа ли страница на статью» —
 * тот же критерий, по которому браузер показывает кнопку режима чтения.
 */
function distill(page: string, pageUrl: string, mustBeReaderable: boolean): Distilled {
  // DOMParser создаёт «инертный» документ: скрипты в нём не исполняются.
  const doc = new DOMParser().parseFromString(page, "text/html");
  // От этого адреса Readability считает относительные ссылки и картинки.
  const base = doc.createElement("base");
  base.href = pageUrl;
  doc.head.prepend(base);

  if (mustBeReaderable && !isProbablyReaderable(doc)) {
    throw new CodedError("not_readerable");
  }
  const parsed = new Readability(doc).parse();
  if (!parsed?.content) {
    throw new CodedError("not_readerable");
  }

  // Readability убирает скрипты, но не обработчики событий и не встроенные
  // плееры. Разметку разбираем в отдельном документе (doc), а не в странице
  // приложения: там её обработчики не срабатывают и картинки не скачиваются.
  const box = doc.createElement("div");
  box.innerHTML = parsed.content;
  // Плееры и формы книге не нужны: на e-ink они бесполезны и тяжелы.
  // <base> опаснее прочих: он перенаправил бы на чужой сайт все запросы книги к серверу.
  for (const junk of box.querySelectorAll("base, script, style, link, meta, iframe, video, audio, object, embed, form")) {
    junk.remove();
  }
  const here = pageUrl.split("#")[0];
  for (const el of box.querySelectorAll("*")) {
    for (const name of el.getAttributeNames()) {
      if (name.toLowerCase().startsWith("on")) {
        el.removeAttribute(name);
      }
    }
    // Ссылки — только на страницы: javascript:, mailto: и прочее книге ни к чему.
    // Сноски и оглавление (ссылки внутрь этой же страницы) Readability
    // превращает в полные адреса; как отдельную статью их не открыть.
    const href = el.getAttribute("href");
    if (href !== null && (!/^https?:\/\//i.test(href) || href.split("#")[0] === here)) {
      el.removeAttribute("href");
    }
    const src = el.getAttribute("src");
    if (src !== null && !/^(https?:\/\/|data:image\/)/i.test(src)) {
      el.removeAttribute("src");
    }
  }
  for (const img of box.querySelectorAll("img")) {
    // Книге хватит одного уменьшенного варианта картинки.
    for (const attribute of ["srcset", "sizes", "loading", "decoding"]) {
      img.removeAttribute(attribute);
    }
    img.setAttribute("src", smallImageUrl(img.getAttribute("src") ?? ""));
  }
  for (const spoiler of box.querySelectorAll("details")) {
    spoiler.setAttribute("open", "");
  }

  return {
    title: oneLine(parsed.title),
    byline: oneLine(parsed.byline),
    siteName: oneLine(parsed.siteName),
    published: parsed.publishedTime ?? "",
    lang: parsed.lang ?? doc.documentElement.lang ?? "",
    minutes: Math.floor((parsed.textContent ?? "").length / CHARS_PER_MINUTE) + 1,
    html: box.innerHTML,
  };
}

interface HabrArticle {
  id: string;
  lang?: string;
  titleHtml: string;
  textHtml: string;
  timePublished: string;
  readingTime: number;
  author?: { alias?: string; fullname?: string | null };
}

function decodeEntities(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

async function loadHabr(id: string, url: string, onStatus: OnStatus): Promise<Article> {
  onStatus("fetching_habr");
  const api = "https://habr.com/kek/v2/articles/" + encodeURIComponent(id) + "/?fl=ru&hl=ru";
  const response = await request(api, {}, 20000);
  if (!response.ok) {
    throw new CodedError("site_status", { status: response.status });
  }
  const habr = (await response.json()) as HabrArticle;

  onStatus("distilling");
  const lang = habr.lang ?? "ru";
  const sourceUrl = "https://habr.com/" + lang + "/articles/" + habr.id + "/";
  // Readability работает с целым документом: собираем его вокруг тела статьи.
  // Проверку «есть ли режим чтения» пропускаем: это заведомо статья.
  const page = '<!DOCTYPE html><html lang="' + lang.replace(/[^\w-]/g, "") + '"><head><title></title></head><body><article>' + habr.textHtml + "</article></body></html>";
  const distilled = distill(page, sourceUrl, false);
  return {
    id: url,
    title: decodeEntities(habr.titleHtml),
    byline: distilled.byline || habr.author?.fullname || habr.author?.alias || "",
    published: habr.timePublished,
    readingTime: habr.readingTime,
    sourceUrl,
    lang,
    html: distilled.html,
  };
}

async function loadPage(url: string, onStatus: OnStatus): Promise<Article> {
  onStatus("fetching_page");
  // Ошибку сервер присылает кодом ({ "error": "timeout" }) — fetchPage
  // превращает её в CodedError.
  const response = await fetchPage(url, 30000);
  const bytes = new Uint8Array(await response.arrayBuffer());

  onStatus("distilling");
  const finalUrl = response.headers.get("X-Final-Url") ?? url;
  const distilled = distill(decodePage(response.headers.get("Content-Type"), bytes), finalUrl, true);
  const host = new URL(finalUrl).hostname;
  return {
    id: url,
    title: distilled.title || host,
    byline: distilled.byline || distilled.siteName || host,
    published: distilled.published,
    readingTime: distilled.minutes,
    sourceUrl: finalUrl,
    lang: distilled.lang,
    html: distilled.html,
  };
}

/** Получает страницу по адресу и превращает её в режим чтения. */
export async function loadArticle(url: string, onStatus: OnStatus): Promise<Article> {
  const habr = habrId(url);
  const article = await (habr ? loadHabr(habr, url, onStatus) : loadPage(url, onStatus));
  // Проверяем ссылки один раз, при подготовке: результат хранится вместе с текстом.
  onStatus("checking_links");
  article.html = await markLinks(article.html);
  return article;
}
