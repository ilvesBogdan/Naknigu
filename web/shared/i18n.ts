// Переводы интерфейса. Тексты лежат в статических JSON-файлах `locales/*.json`
// каждого клиента; здесь — только выбор языка и подстановка значений.
import type { Args } from "./protocol";

export type Lang = "ru" | "en";
export type Dictionary = Record<string, string>;

const LANGS: readonly Lang[] = ["ru", "en"];

/** Выбирает язык: сохранённый выбор важнее языка браузера. */
export function pickLang(saved: string | null, browser: string | undefined): Lang {
  if (saved === "ru" || saved === "en") {
    return saved;
  }
  return (browser || "").toLowerCase().indexOf("ru") === 0 ? "ru" : "en";
}

/**
 * Язык, который книге нужно перенять у телефона, или null — менять нечего.
 * Перенимается только новый для книги язык телефона: если на книге после
 * этого выбрали другой язык в меню, он держится, пока язык не сменят на телефоне.
 */
export function langFromPhone(received: unknown, lastFromPhone: string | null): Lang | null {
  return (received === "ru" || received === "en") && received !== lastFromPhone ? received : null;
}

/** Следующий язык по кругу — для кнопки переключения. */
export function nextLang(lang: Lang): Lang {
  return LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
}

/**
 * Возвращает текст по ключу и подставляет значения вместо {имя}.
 * Неизвестный ключ возвращается как есть — так пропуск сразу виден на экране.
 */
export function translate(dictionary: Dictionary, key: string, args: Args = {}): string {
  const template = Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key;
  return template.replace(/\{(\w+)}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(args, name) ? String(args[name]) : whole,
  );
}

/**
 * Текст ошибки по её коду. Незнакомый код (например, от более новой версии
 * второго клиента) показывается через `errors.unknown`.
 */
export function translateError(dictionary: Dictionary, code: string, args: Args = {}): string {
  const key = "errors." + code;
  return Object.prototype.hasOwnProperty.call(dictionary, key)
    ? translate(dictionary, key, args)
    : translate(dictionary, "errors.unknown", { code });
}
