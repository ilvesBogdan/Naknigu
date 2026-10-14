// Service worker нужен только затем, чтобы браузер согласился установить
// приложение на рабочий стол телефона. Он ничего не кэширует: все запросы
// идут в сеть, как и без него, поэтому устаревшей версии взяться неоткуда.
// Типы service worker описаны здесь же: обычный .js-файл не видит
// библиотеку WebWorker, а описаны только те части, что нужны коду ниже.
/**
 * @typedef {object} SwEvent
 * @property {(promise: Promise<unknown>) => void} waitUntil
 */
/**
 * @typedef {object} SwNotificationEvent
 * @property {{ data: string, close: () => void }} notification
 * @property {(promise: Promise<unknown>) => void} waitUntil
 */
/**
 * @typedef {object} SwScope
 * @property {() => Promise<void>} skipWaiting
 * @property {{ claim: () => Promise<void>, openWindow: (url: string) => Promise<unknown> }} clients
 * @property {(type: string, listener: (event: *) => void) => void} addEventListener
 */

/** Глобальный объект service worker. */
const sw = /** @type {SwScope} */ (/** @type {unknown} */ (self));

sw.addEventListener("install", () => void sw.skipWaiting());
sw.addEventListener("activate", (/** @type {SwEvent} */ event) => event.waitUntil(sw.clients.claim()));
sw.addEventListener("fetch", () => {});

// Уведомление о ссылке, которую на книге попросили открыть на телефоне:
// нажатие открывает её.
sw.addEventListener("notificationclick", (/** @type {SwNotificationEvent} */ event) => {
  event.notification.close();
  // Открываем только адреса страниц.
  if (/^https?:\/\//i.test(event.notification.data)) {
    event.waitUntil(sw.clients.openWindow(event.notification.data));
  }
});
