// Язык интерфейса телефона. Тексты — в статических файлах locales/*.json.
import { type Dictionary, type Lang, pickLang, translate, translateError } from "../../../shared/i18n";
import type { Args } from "../../../shared/protocol";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const DICTIONARIES: Record<Lang, Dictionary> = { ru, en };

// Язык определяется по языку браузера; переключателя в интерфейсе нет.
const lang: Lang = pickLang(null, navigator.language);

export function t(key: string, args?: Args): string {
  return translate(DICTIONARIES[lang], key, args);
}

export function tError(code: string, args?: Args): string {
  return translateError(DICTIONARIES[lang], code, args);
}

export function currentLang(): Lang {
  return lang;
}
