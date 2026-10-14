// Клиент электронной книги. Статей сам не скачивает и не хранит: показывает
// QR-код для телефона, ждёт от него готовую статью, разбивает её на экраны
// и сообщает телефону прогресс чтения. У себя хранит только идентификатор
// сессии, признак «телефон связан», язык, настройки шрифта, способ листания
// и поворот экрана.
//
// Браузер книги старый и медленный: кода здесь должно быть как можно меньше.
// Страница открывается из кэша и без сети — см. static/sw.js, offline()
// и checkUpdate().
import { type Article, type BookMessage, type Progress, ROTATIONS } from "../../shared/protocol";
import { store } from "../../shared/storage";
import { fitScreen, byId, pageSize, show, shown } from "./dom";
import { adoptPhoneLang, applyStaticTexts, forgetPhoneLang, switchLang, t, tError } from "./i18n";
import { Link } from "./link";
import { loadingLog } from "./log";
import { localMove, swipeTurn } from "./pager";
import { Paginator } from "./paginator";
import { loadQr } from "./qrloader";
import { offerShowcase } from "./showcase";
import {
  SIZE,
  SPACINGS,
  SPACING_KEYS,
  fontFamily,
  loadFont,
  restoreSettings,
  rotation,
  saveFont,
  setRotation,
  setSwipe,
  swipe,
} from "./settings";

const font = loadFont();
const paginator = new Paginator();
const link = new Link(handle, idle, offline);

let current: Article | null = null;

// --- Экран связывания ---

function fitQr(): void {
  // Размер считаем сами: экран должен вместить всё без прокрутки.
  const [width, height] = pageSize();
  const size = Math.floor(Math.min(width * 0.7, height * 0.45));
  byId("qr").style.width = size + "px";
  byId("qr").style.height = size + "px";
}

function showPairing(): void {
  byId("pair-reset").style.display = link.paired ? "" : "none";
  if (link.paired) {
    // Код больше не показываем: связь один к одному, второй телефон не подключится.
    byId("pair-text").textContent = t("pair.connected");
    byId("qr").style.display = "none";
    byId("pair-url").textContent = "";
  } else {
    const url = link.phoneUrl();
    byId("qr").textContent = "";
    byId("qr").style.display = "";
    byId("pair-text").textContent = t("pair.scan");
    byId("pair-url").textContent = url;
    fitQr();
    // Код рисует отдельный файл: связанной книге он не нужен. Пока он
    // грузится, адрес уже виден текстом.
    loadQr().then(
      (svg) => {
        // За время загрузки телефон мог связаться, а сессия — смениться.
        if (!link.paired && url === link.phoneUrl()) {
          byId("qr").innerHTML = svg(url);
        }
      },
      () => undefined,
    );
  }
  show("pairing");
}

// --- Чтение ---

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? m[3] + "." + m[2] + "." + m[1] : "";
}

function reflow(): void {
  if (current && shown() === "reading") {
    paginator.reflow(font);
  }
}

let reflowTimer = 0;
function scheduleReflow(): void {
  clearTimeout(reflowTimer);
  reflowTimer = window.setTimeout(reflow, 300);
}

function progress(): Progress | null {
  return current ? { articleId: current.id, anchor: paginator.anchor, percent: paginator.percent() } : null;
}

let progressTimer = 0;
function scheduleProgress(): void {
  clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => {
    const p = progress();
    if (p) {
      link.send({ type: "progress", articleId: p.articleId, anchor: p.anchor, percent: p.percent });
    }
  }, 800);
}

function turnPage(direction: number): void {
  if (current) {
    closeLinkBox();
    paginator.turn(direction);
    scheduleProgress();
  }
}

/** Подписи статьи, которые зависят от языка интерфейса. */
function drawArticleTexts(article: Article): void {
  const meta = [article.byline, formatDate(article.published)];
  if (article.readingTime) {
    meta.push(t("reading.minutes", { n: article.readingTime }));
  }
  byId("meta").textContent = meta.filter(Boolean).join(" · ");
  byId("source").textContent = t("reading.source", { url: article.sourceUrl });
}

/** Язык интерфейса сменился: обновляем тексты, которых нет в разметке. */
function redrawTexts(): void {
  if (current) {
    drawArticleTexts(current);
  } else {
    document.title = t("pair.title");
    if (shown() === "pairing") {
      showPairing();
    }
  }
}

function render(article: Article, anchor: number): void {
  current = article;
  closeLinkBox();

  document.title = article.title;
  byId("title").textContent = article.title;
  // HTML очищен на телефоне (web/phone/src/lib/loader.ts): скриптов, обработчиков
  // событий и встроенных плееров в нём нет.
  byId("content").innerHTML = article.html;
  paginator.open(anchor);
  // Переносы расставляются по языку статьи, а не по языку интерфейса.
  byId("flow").lang = article.lang || document.documentElement.lang;
  drawArticleTexts(article);

  // Каждая загруженная картинка сдвигает текст — раскладываем заново.
  const images = byId("content").getElementsByTagName("img");
  for (let i = 0; i < images.length; i++) {
    images[i].addEventListener("load", scheduleReflow);
  }

  loadingLog.hide();
  show("reading");
  reflow();
}

// --- Ссылки в статье ---
// Нажатие на ссылку не уводит со страницы, а спрашивает, где её открыть.

let linkUrl = "";

function closeLinkBox(): void {
  byId("linkbox").className = "";
}

/** Просит телефон открыть ссылку: у себя в браузере или статьёй на книге. */
function askPhone(article: boolean): void {
  closeLinkBox();
  link.send({ type: "link", url: linkUrl, article, progress: progress() });
  loadingLog.add(t("log.sent_to_phone"));
  loadingLog.add(t("log.tap_to_close"));
}

byId("content").onclick = (e) => {
  const a = (e.target as Element).closest("a");
  if (a) {
    e.preventDefault();
    const url = (a as HTMLAnchorElement).href;
    // Остальное (почта, javascript:) не открываем вовсе.
    if (/^https?:/.test(url)) {
      linkUrl = url;
      // Телефон при подготовке статьи отметил ссылки, которые статьёй не открыть.
      byId("link-article").style.display = a.hasAttribute("data-plain") ? "none" : "";
      byId("link-url").textContent = linkUrl;
      byId("linkbox").className = "shown";
    }
  }
};
byId("link-here").onclick = () => {
  location.href = linkUrl;
};
byId("link-phone").onclick = () => askPhone(false);
byId("link-article").onclick = () => askPhone(true);
byId("link-cancel").onclick = closeLinkBox;

// --- Сообщения от телефона ---

function handle(message: BookMessage, version: string): Promise<void> {
  const session = link.session;
  link.markPaired();
  if (restoreSettings(message)) {
    fitScreen();
    fitQr();
    reflow();
  }
  // Связались с телефоном — интерфейс книги переходит на его язык.
  if (adoptPhoneLang(message.lang)) {
    redrawTexts();
  }
  switch (message.type) {
    case "paired":
      if (!current) {
        loadingLog.hide();
        showPairing();
      }
      return Promise.resolve();
    case "status":
      loadingLog.add(t("status." + message.key, message.args));
      return Promise.resolve();
    case "error":
      loadingLog.add(t("log.error", { text: tError(message.code, message.args) }));
      loadingLog.add(t("log.tap_to_close"));
      return Promise.resolve();
    case "article":
      if (current && current.id === message.article.id && current.html === message.article.html) {
        // Та же статья уже на экране: телефон прислал её заново ради настроек
        // или чтобы сообщить, что ссылку открыть не удалось. Заново
        // не рисуем — место чтения остаётся как есть.
        loadingLog.hide();
        if (message.error) {
          loadingLog.add(t("log.error", { text: tError(message.error.code, message.error.args) }));
          loadingLog.add(t("log.tap_to_close"));
        }
        return Promise.resolve();
      }
      return link.freshAnchor(message.article.id, message.anchor, version).then((anchor) => {
        // Пока шёл запрос, на книге могли нажать «Выйти»: статья прежней сессии не нужна.
        if (session !== link.session) {
          return;
        }
        try {
          render(message.article, anchor);
        } catch (error) {
          // Иначе ошибка утонула бы в цикле приёма, а на экране остался бы лог.
          loadingLog.add(t("log.error", { text: String(error) }));
        }
      });
  }
}

// --- Меню: переход по статье, шрифт, язык, выход ---

/** Страница (с единицы), выбранная в меню для перехода. */
let target = 1;

function drawMenu(): void {
  const page = byId("page-target");
  page.textContent = target + " / " + paginator.pages;
  // Рамка — знак, что нажатие перейдёт на выбранную страницу.
  page.className = target === paginator.page + 1 ? "" : "go";
  byId("font-size").textContent = font.size + " px";
  byId("font-family").textContent = t(font.serif ? "menu.font_family.serif" : "menu.font_family.sans");
  byId("font-spacing").textContent = t(SPACING_KEYS[SPACINGS.indexOf(font.spacing)]);
  byId("language").textContent = t("menu.language.name");
  // Настройки: выбранный вариант закрашен.
  for (let i = 0; i < ROTATIONS.length; i++) {
    byId("rot-" + ROTATIONS[i]).className = ROTATIONS[i] === rotation ? "chosen" : "";
  }
  byId("swipe-vertical").className = swipe === "vertical" ? "chosen" : "";
  byId("swipe-horizontal").className = swipe === "horizontal" ? "chosen" : "";
  const sample = byId("font-sample");
  sample.style.fontSize = font.size + "px";
  sample.style.lineHeight = String(font.spacing);
  sample.style.fontFamily = fontFamily(font);
}

/** Список заголовков статьи: нажатие открывает страницу с заголовком. */
function drawContents(): void {
  const toc = byId("toc");
  const headings = byId("content").querySelectorAll("h2,h3,h4");
  toc.textContent = "";
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const text = (heading.textContent || "").trim();
    if (text) {
      const item = document.createElement("button");
      item.className = heading.tagName.toLowerCase();
      item.textContent = text;
      item.onclick = () => closeMenu(() => paginator.show(heading));
      toc.appendChild(item);
    }
  }
  if (!toc.firstChild) {
    toc.appendChild(document.createElement("p")).textContent = t("menu.no_headings");
  }
}

function openMenu(): void {
  if (shown() !== "reading") {
    return;
  }
  closeLinkBox();
  target = paginator.page + 1;
  byId("menu").className = "nav";
  byId("more-menu").className = "";
  drawContents();
  drawMenu();
  show("menu");
}

/**
 * Закрывает меню. Переход (go) делается уже после раскладки: пока открыто
 * меню, статья скрыта и положение её частей не узнать.
 */
function closeMenu(go?: () => void): void {
  show("reading");
  reflow();
  if (go) {
    go();
    scheduleProgress();
  }
}

function changeTarget(by: number): void {
  target = Math.max(1, Math.min(paginator.pages, target + by));
  drawMenu();
}

function changeFont(change: () => void): void {
  change();
  saveFont(font);
  // С новым шрифтом страниц станет другое число: выбранный номер уже ни о чём.
  target = paginator.page + 1;
  drawMenu();
}

function menuButton(id: string, action: () => void): void {
  byId(id).onclick = action;
}

/**
 * Выход: телефон остаётся при своих статьях, книга заводит новую сессию
 * и снова показывает код.
 */
function logout(): void {
  clearTimeout(progressTimer);
  link.send({ type: "unpaired", progress: progress() });
  link.reset();
  forgetPhoneLang();

  current = null;
  byId("content").textContent = "";
  document.title = t("pair.title");
  showPairing();
}

// --- Управление ---

byId("prev").onclick = () => turnPage(-1);
byId("next").onclick = () => turnPage(1);
// Меню открывается нажатием на номер страницы между кнопками листания.
byId("pageno").onclick = openMenu;

menuButton("font-smaller", () => changeFont(() => (font.size = Math.max(SIZE.min, font.size - SIZE.step))));
menuButton("font-bigger", () => changeFont(() => (font.size = Math.min(SIZE.max, font.size + SIZE.step))));
menuButton("font-family", () => changeFont(() => (font.serif = !font.serif)));
menuButton("font-spacing", () =>
  changeFont(() => (font.spacing = SPACINGS[(SPACINGS.indexOf(font.spacing) + 1) % SPACINGS.length])),
);
menuButton("language", () => {
  switchLang();
  redrawTexts();
  drawMenu();
});
menuButton("menu-close", () => closeMenu());
menuButton("tab-nav", () => (byId("menu").className = "nav"));
menuButton("tab-font", () => (byId("menu").className = "font"));
menuButton("menu-settings", () => (byId("menu").className = "settings"));

/** Настройку сменили: применяем и сообщаем телефону — он хранит копию. */
function changeSetting(change: () => void): void {
  change();
  fitScreen();
  drawMenu();
  link.send({ type: "settings", progress: progress() });
}
ROTATIONS.forEach((value) => menuButton("rot-" + value, () => changeSetting(() => setRotation(value))));
menuButton("swipe-vertical", () => changeSetting(() => setSwipe("vertical")));
menuButton("swipe-horizontal", () => changeSetting(() => setSwipe("horizontal")));
menuButton("page-back10", () => changeTarget(-10));
menuButton("page-back", () => changeTarget(-1));
menuButton("page-fwd", () => changeTarget(1));
menuButton("page-fwd10", () => changeTarget(10));
menuButton("page-target", () => {
  if (target !== paginator.page + 1) {
    closeMenu(() => paginator.turn(target - 1 - paginator.page));
  }
});
menuButton("more", () => {
  const more = byId("more-menu");
  more.className = more.className ? "" : "shown";
});
// Нажатие мимо выпадающего меню закрывает его.
byId("menu").addEventListener("click", (e) => {
  if (!(e.target as Element).closest("#more,#more-menu")) {
    byId("more-menu").className = "";
  }
});
menuButton("menu-exit", logout);

// Листание смахиванием — в дополнение к кнопкам. Направление выбирают в настройках.
let swipeStartX = 0;
let swipeStartY = 0;
byId("page").addEventListener("touchstart", (e) => {
  swipeStartX = e.touches[0].clientX;
  swipeStartY = e.touches[0].clientY;
});
byId("page").addEventListener("touchend", (e) => {
  const touch = e.changedTouches[0];
  // Палец движется по экрану устройства, а страница может быть повёрнута.
  const move = localMove(touch.clientX - swipeStartX, touch.clientY - swipeStartY, rotation);
  const direction = swipeTurn(move[0], move[1], swipe);
  if (direction) {
    turnPage(direction);
  }
});
byId("pair-reset").onclick = logout;

byId("loading").onclick = () => {
  loadingLog.hide();
  if (!current) {
    showPairing();
  }
};
window.addEventListener("resize", () => {
  fitScreen();
  fitQr();
  scheduleReflow();
});
// Страницу вернули из памяти браузера (назад — вперёд по истории): размер
// экрана за это время мог измениться.
window.addEventListener("pageshow", scheduleReflow);
window.onerror = (message) => {
  loadingLog.add(t("log.error", { text: String(message) }));
};

/** Связанной книге при запуске нечего показать: сервер статью не помнит (его перезапускали). */
function idle(): void {
  if (!current) {
    loadingLog.hide();
    showPairing();
  }
}

/**
 * До сервера не достучаться: у книги ещё не поднялся Wi-Fi или сервер
 * выключен. Страница открылась из кэша браузера и ждёт — говорим об этом.
 */
let waiting = false;
function offline(): void {
  if (!waiting) {
    waiting = true;
    loadingLog.add(t("log.offline"));
  }
}

/**
 * Страница книги могла открыться из кэша (см. static/sw.js), поэтому
 * проверяем здесь, нет ли новой версии: спрашиваем у сайта свежую страницу
 * и, если та собрана из другой версии, загружаемся заново. Не больше одного
 * раза на версию: иначе при любой неувязке с кэшем книга перезагружалась
 * бы без конца.
 */
function checkUpdate(): void {
  fetch(location.pathname, { cache: "no-cache" })
    .then((response) => response.text())
    .then(
      (html) => {
        const found = /\?v=(\w+)/.exec(html);
        if (found && found[1] !== BUILD && store.get("naknigu.book.build") !== found[1] && store.set("naknigu.book.build", found[1])) {
          location.reload();
        }
      },
      // Сети пока нет — проверим позже.
      () => setTimeout(checkUpdate, 30000),
    );
}

fitScreen();
applyStaticTexts();
document.title = t("pair.title");
if (link.paired) {
  // Книга уже связана с телефоном: код не показываем даже на мгновение.
  // Сервер помнит последнюю статью (страницу просто перезагрузили) —
  // она придёт тут же, а пока на экране строка лога.
  loadingLog.add(t("log.restoring"));
} else {
  showPairing();
}
link.listen();
checkUpdate();

// Страница и её файлы остаются в кэше service worker'а и открываются, даже
// когда у книги ещё не поднялся Wi-Fi. Где service worker'ов нет, остаётся
// обычный кэш браузера.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => undefined);
}
// В современном браузере вместо экрана связывания — витрина проекта.
if (!link.paired) {
  offerShowcase();
}
