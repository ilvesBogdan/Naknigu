// Витрина проекта. Её подгружает страница книги (web/book/src/showcase.ts),
// и только в современных браузерах; в браузере электронной книги страница
// остаётся прежней.
//
// Витрина ничего не знает о коде книги, кроме разметки её экрана связывания:
// код и адрес она копирует из #qr и #pair-url, строку состояния — из #log.
// Нажатие на код показывает сам экран книги во весь экран. Как только
// телефон отсканировал код (книга ушла с экрана связывания), витрина
// уступает место книге насовсем.
//
// Все тексты — обычный текст страницы: его можно выделить, его читают
// экранные дикторы. Нарисованные устройства помечены aria-hidden.
//
// Словари в код не входят: build.sh кладёт их рядом (locales/ru.json,
// locales/en.json), и витрина скачивает только словарь выбранного языка.
// Второй скачивается, лишь когда язык переключат.
import { type Dictionary, type Lang, pickLang, translate } from "../../shared/i18n";
import { store } from "../../shared/storage";
import template from "./showcase.html";

/** Репозиторий проекта (владелец/имя); подставляется при сборке. */
declare const __REPO__: string | undefined;
const REPO = typeof __REPO__ === "string" && __REPO__ ? __REPO__ : "ilvesBogdan/naknigu";
const LINKS: Record<string, string> = { repo: "https://github.com/" + REPO };

/**
 * Номер сборки словарей; подставляется при сборке. Он стоит в адресе
 * словаря: свежий showcase.js не возьмёт из кэша браузера старый словарь.
 */
declare const __LOCALES__: string | undefined;
const LOCALES_VERSION = typeof __LOCALES__ === "string" ? __LOCALES__ : "";

const LANG_KEY = "naknigu.site.lang";

const root = document.documentElement;
const bookTitle = document.title;
let lang: Lang = pickLang(store.get(LANG_KEY), navigator.language);
let dictionary: Dictionary = {};
const loaded: Partial<Record<Lang, Dictionary>> = {};

/** Скачивает словарь языка один раз; адрес — относительно showcase.js. */
function loadDictionary(wanted: Lang): Promise<Dictionary> {
  const known = loaded[wanted];
  if (known) {
    return Promise.resolve(known);
  }
  const url = new URL("locales/" + wanted + ".json?v=" + LOCALES_VERSION, import.meta.url);
  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error("dictionary " + wanted + ": HTTP " + response.status);
      }
      return response.json() as Promise<Dictionary>;
    })
    .then((received) => (loaded[wanted] = received));
}

function t(key: string): string {
  return translate(dictionary, key);
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error("missing element #" + id);
  }
  return el;
}

// --- Разметка ---

const holder = document.createElement("div");
holder.innerHTML = template; // разметка из нашей же сборки, переводы ставятся как текст
const parts = Array.from(holder.children) as HTMLElement[];
const page = parts.find((el) => el.id === "nk")!;
const back = parts.find((el) => el.classList.contains("nk-back"))!;
document.body.append(...parts);

function applyTexts(): void {
  page.lang = lang;
  back.lang = lang;
  for (const part of parts) {
    for (const el of part.querySelectorAll("[data-i18n]")) {
      el.textContent = t(el.getAttribute("data-i18n")!);
    }
    for (const el of part.querySelectorAll("[data-i18n-attr]")) {
      for (const pair of el.getAttribute("data-i18n-attr")!.split(";")) {
        const [attribute, key] = pair.split(":");
        el.setAttribute(attribute, t(key));
      }
    }
  }
  for (const button of page.querySelectorAll("[data-lang]")) {
    button.setAttribute("aria-pressed", String(button.getAttribute("data-lang") === lang));
  }
  if (root.classList.contains("showcase")) {
    document.title = t("meta.title");
  }
}

for (const link of page.querySelectorAll<HTMLAnchorElement>("[data-href]")) {
  link.href = LINKS[link.dataset.href!];
}

for (const button of page.querySelectorAll<HTMLButtonElement>("[data-lang]")) {
  button.addEventListener("click", () => {
    const wanted = button.dataset.lang as Lang;
    // Словарь не скачался — язык остаётся прежним.
    loadDictionary(wanted).then(
      (received) => {
        lang = wanted;
        dictionary = received;
        store.set(LANG_KEY, lang);
        applyTexts();
      },
      () => undefined,
    );
  });
}

// --- Код книги на нарисованной книге ---

const qr = byId("qr");
const url = byId("pair-url");
const log = byId("log");

function mirror(): void {
  for (const slot of page.querySelectorAll("[data-qr]")) {
    slot.innerHTML = qr.innerHTML; // SVG, нарисованный кодом книги
  }
  for (const slot of page.querySelectorAll("[data-url]")) {
    slot.textContent = url.textContent;
  }
  // Строка лога книги: например, «Нет связи с сервером. Жду…».
  const status = byId("loading").classList.contains("shown") ? (log.lastElementChild?.textContent ?? "") : "";
  for (const slot of page.querySelectorAll("[data-status]")) {
    slot.textContent = status;
  }
}

const watch = new MutationObserver(() => {
  mirror();
  // Телефон отсканировал код: книга ушла с экрана связывания (или убрала код).
  if (document.body.className !== "pairing" || qr.style.display === "none") {
    retire();
  }
});
watch.observe(qr, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
watch.observe(url, { childList: true, characterData: true, subtree: true });
watch.observe(byId("loading"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
watch.observe(document.body, { attributes: true, attributeFilter: ["class"] });

// --- Экран книги во весь экран ---

let scrollY = 0;
const inBook = () => root.classList.contains("nk-book");

function refitBook(): void {
  // Экран книги подгоняет себя под окно по событию resize (fitScreen).
  window.dispatchEvent(new Event("resize"));
}

function openBook(): void {
  if (inBook()) {
    return;
  }
  scrollY = window.scrollY;
  // Во весь экран браузер пускает только по нажатию — просим сразу.
  root.requestFullscreen?.().catch(() => undefined);
  root.classList.replace("showcase", "nk-book");
  document.title = bookTitle;
  history.pushState({ nakniguBook: true }, "");
  refitBook();
  back.focus();
}

function closeBook(fromHistory = false): void {
  if (!inBook()) {
    return;
  }
  root.classList.replace("nk-book", "showcase");
  document.title = t("meta.title");
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
  }
  if (!fromHistory && history.state?.nakniguBook) {
    history.back();
  }
  window.scrollTo(0, scrollY);
  page.querySelector<HTMLElement>(".nk-qr")?.focus({ preventScroll: true });
}

/** Телефон связан с книгой: витрина больше не нужна, остаётся книга. */
function retire(): void {
  watch.disconnect();
  root.classList.remove("showcase", "nk-book");
  themeColors.forEach((meta) => meta.remove());
  document.title = bookTitle;
  page.remove();
  back.remove();
  refitBook();
}

for (const button of page.querySelectorAll<HTMLElement>("[data-open-book]")) {
  button.addEventListener("click", openBook);
}
back.addEventListener("click", () => closeBook());
window.addEventListener("popstate", () => {
  if (!history.state?.nakniguBook) {
    closeBook(true);
  }
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    closeBook();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeBook();
  }
});

// --- Показ ---

// Цвет панели браузера (вкладки, адресная строка) — под фон витрины, свой
// для светлой и тёмной темы. Значения — --nk-paper из showcase.css в hex:
// oklch() в theme-color понимают не все браузеры.
const themeColors = [
  ["(prefers-color-scheme: light)", "#f9f7f2"],
  ["(prefers-color-scheme: dark)", "#15120f"],
].map(([media, color]) => {
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.media = media;
  meta.content = color;
  return meta;
});

// Витрина показывается только с текстами: пока словарь в пути, её скрывает
// CSS (нет класса showcase), а экран книги прячет web/book/src/showcase.ts.
// Словарь не скачался — витрина уступает место книге. Сигнал книге уходит
// в любом случае: так экран книги не ждёт своих трёх секунд зря.
loadDictionary(lang)
  .then((received) => {
    // Пока скачивался словарь, телефон мог уже отсканировать код.
    if (!page.isConnected) {
      return;
    }
    dictionary = received;
    document.head.append(...themeColors);
    root.classList.add("showcase");
    applyTexts();
    mirror();
    if (document.body.className !== "pairing" || qr.style.display === "none") {
      retire();
    }
  }, retire)
  .finally(() => window.dispatchEvent(new Event("naknigu:showcase")));
