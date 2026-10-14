// Разбор адресов статей.

/**
 * Приводит введённое пользователем к адресу страницы.
 * Пустая строка в ответе означает, что это не адрес.
 */
export function normalizeUrl(input: string): string {
  let text = input.trim();
  if (/^\d{3,}$/.test(text)) {
    // Просто номер — это статья Habr.
    return "https://habr.com/ru/articles/" + text + "/";
  }
  if (text && !/^https?:\/\//i.test(text)) {
    text = "https://" + text;
  }
  try {
    const url = new URL(text);
    // У настоящего сайта в имени есть точка и буквы: так отсекаются
    // слова без домена и числа, которые URL считает IP-адресами.
    return url.hostname.includes(".") && /[a-zа-я]/i.test(url.hostname) ? url.href : "";
  } catch {
    return "";
  }
}

/**
 * Номер статьи Habr из её адреса или пустая строка. Статьи Habr берутся
 * из его JSON API напрямую из браузера, без посредника.
 */
export function habrId(url: string): string {
  const match = /^https?:\/\/(?:m\.)?habr\.com\/([^?#]*)/i.exec(url);
  if (!match) {
    return "";
  }
  // Номер — последний числовой сегмент пути: /ru/articles/891426/,
  // /ru/companies/x/articles/891426/, /ru/post/891426/.
  const ids = match[1].split("/").filter((segment) => /^\d{3,}$/.test(segment));
  return ids.length ? ids[ids.length - 1] : "";
}

/**
 * Заменяет «ретину» habrastorage (1560px) на вариант 780px: экрану книги
 * этого достаточно, а трафика и памяти уходит вчетверо меньше.
 */
export function smallImageUrl(src: string): string {
  const prefix = "https://habrastorage.org/r/w1560/";
  return src.startsWith(prefix) ? src.replace("/r/w1560/", "/r/w780/") : src;
}

/**
 * Ссылка из того, чем с приложением поделились через меню «Поделиться».
 * Android кладёт адрес то в url, то прямо в текст («Заголовок https://…»),
 * поэтому ищем его во всех полях. Пустая строка — ссылки нет.
 */
export function sharedUrl(params: URLSearchParams): string {
  const url = (params.get("url") ?? "").trim();
  if (/^https?:\/\//i.test(url)) {
    return url; // это поле — сама ссылка, в ней всё значимо
  }
  for (const field of [params.get("text"), params.get("title")]) {
    const match = /https?:\/\/[^\s<>"]+/i.exec(field ?? "");
    if (match) {
      // Знак препинания после ссылки в тексте — не её часть.
      return match[0].replace(/[.,;:!?)»"']+$/, "");
    }
  }
  return "";
}
