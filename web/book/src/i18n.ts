// Язык интерфейса книги. Тексты — в статических файлах locales/*.json.
import { type Dictionary, type Lang, langFromPhone, nextLang, pickLang, translate, translateError } from "../../shared/i18n";
import type { Args } from "../../shared/protocol";
import { store } from "../../shared/storage";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const DICTIONARIES: Record<Lang, Dictionary> = { ru, en };
const KEY = "naknigu.book.lang";
/** Последний язык, полученный от телефона. */
const PHONE_KEY = "naknigu.book.lang.phone";

// До связи с телефоном — язык браузера книги (или выбранный в меню).
let lang: Lang = pickLang(store.get(KEY), navigator.language);

export function t(key: string, args?: Args): string {
  return translate(DICTIONARIES[lang], key, args);
}

export function tError(code: string, args?: Args): string {
  return translateError(DICTIONARIES[lang], code, args);
}

/** Переключает язык на следующий и запоминает выбор на книге. */
export function switchLang(): void {
  lang = nextLang(lang);
  store.set(KEY, lang);
  applyStaticTexts();
}

/**
 * Перенимает язык телефона. Возвращает true, если язык интерфейса сменился.
 */
export function adoptPhoneLang(received: unknown): boolean {
  const adopted = langFromPhone(received, store.get(PHONE_KEY));
  if (!adopted) {
    return false;
  }
  store.set(PHONE_KEY, adopted);
  if (adopted === lang) {
    return false;
  }
  lang = adopted;
  store.set(KEY, lang);
  applyStaticTexts();
  return true;
}

/** Забывает язык телефона: следующий телефон принесёт свой. */
export function forgetPhoneLang(): void {
  store.remove(PHONE_KEY);
}

/**
 * Подставляет тексты в разметку: элемент с атрибутом data-i18n="ключ"
 * получает перевод этого ключа.
 */
export function applyStaticTexts(): void {
  document.documentElement.lang = lang;
  const nodes = document.querySelectorAll("[data-i18n]");
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].textContent = t(nodes[i].getAttribute("data-i18n") || "");
  }
}
