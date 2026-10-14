// Service worker страницы книги: она открывается даже без сети.
//
// Wi-Fi у электронной книги засыпает вместе с ней и поднимается не сразу.
// Если браузер в этот момент пойдёт за страницей на сайт, он покажет свою
// ошибку «адрес недоступен» и останется на ней: наш код там не работает
// и повторить запрос не может. GitHub Pages не даёт задать долгий срок
// хранения в кэше браузера (он всегда 10 минут), поэтому страницу хранит
// этот service worker.
//
// - Страница (index.html): сначала сеть, не дольше 5 секунд, иначе — копия
//   из кэша. Свежая страница кладётся в кэш только вместе со всеми её файлами
//   (book.js, style.css, qr.js с тем же номером сборки): копия в кэше всегда
//   целая, и без сети не получится страницы, у которой нет кода.
// - Файлы с номером сборки в адресе (book.js?v=…): из кэша, а если их там
//   нет — из сети. Номер меняется вместе с содержимым, так что копия не устаревает.
// - Всё остальное (API, витрина, клиент телефона) идёт мимо.
// Типы service worker описаны здесь же: обычный .js-файл не видит
// библиотеку WebWorker, а описаны только те части, что нужны коду ниже.
/**
 * @typedef {object} SwEvent
 * @property {(promise: Promise<unknown>) => void} waitUntil
 */
/**
 * @typedef {object} SwFetchEvent
 * @property {RequestInfo} request
 * @property {(promise: Promise<unknown>) => void} waitUntil
 * @property {(response: Promise<Response>) => void} respondWith
 */
/**
 * @typedef {object} SwScope
 * @property {Location} location
 * @property {() => Promise<void>} skipWaiting
 * @property {{ claim: () => Promise<void> }} clients
 * @property {(type: string, listener: (event: *) => void) => void} addEventListener
 */

/** Глобальный объект service worker. */
const sw = /** @type {SwScope} */ (/** @type {unknown} */ (self));
const CACHE = "naknigu-book";
const PAGE = new URL("./", sw.location.href).href;
const FILES = ["book.js", "style.css", "qr.js"];

// Страница кладётся в кэш сразу при установке: при самом первом открытии
// service worker ещё не перехватывает запросы, а без сети книга может
// оказаться уже при следующем включении.
sw.addEventListener("install", (/** @type {SwEvent} */ event) => {
  void sw.skipWaiting();
  event.waitUntil(
    fetch(PAGE)
      .then((response) => (response.ok ? remember(response) : undefined))
      .catch(() => undefined),
  );
});
sw.addEventListener("activate", (/** @type {SwEvent} */ event) => event.waitUntil(sw.clients.claim()));

sw.addEventListener("fetch", (/** @type {SwFetchEvent} */ event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== sw.location.origin) {
    return;
  }
  if (request.mode === "navigate" && url.href.split(/[?#]/)[0] === PAGE) {
    event.respondWith(page(event));
  } else if (url.href.startsWith(PAGE) && /[?&]v=\w+/.test(url.search)) {
    event.respondWith(file(request));
  }
});

/**
 * @param {SwFetchEvent} event
 * @returns {Promise<Response>}
 */
async function page(event) {
  try {
    const response = await withTimeout(fetch(event.request), 5000);
    if (response.ok) {
      event.waitUntil(remember(response.clone()).catch(() => undefined));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(PAGE);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

/**
 * @param {RequestInfo} request
 * @returns {Promise<Response>}
 */
async function file(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * Кладёт страницу в кэш вместе с её файлами и убирает файлы прежних сборок.
 * @param {Response} response
 * @returns {Promise<void>}
 */
async function remember(response) {
  const html = await response.clone().text();
  const build = /\?v=(\w+)/.exec(html);
  if (!build) {
    return;
  }
  const cache = await caches.open(CACHE);
  const files = FILES.map((name) => new URL(name + "?v=" + build[1], PAGE).href);
  await cache.addAll(files);
  await cache.put(PAGE, response);
  for (const request of await cache.keys()) {
    if (request.url !== PAGE && !files.includes(request.url)) {
      await cache.delete(request);
    }
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
