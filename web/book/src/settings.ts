// Настройки книги: шрифт, способ листания и поворот экрана. Выбираются в её
// меню и хранятся на ней; телефон держит копию, чтобы вернуть при надобности.
import { ROTATIONS, type Rotation, type Swipe } from "../../shared/protocol";
import { store } from "../../shared/storage";
import { clamp } from "./pager";

export interface FontSettings {
  /** Размер в пикселях. */
  size: number;
  serif: boolean;
  /** Желаемый межстрочный интервал в долях размера шрифта. */
  spacing: number;
}

export const SIZE = { min: 14, max: 40, step: 2 };
export const SPACINGS = [1.3, 1.5, 1.7];
/** Ключи словаря для названий интервалов, в том же порядке, что SPACINGS. */
export const SPACING_KEYS = ["menu.spacing.tight", "menu.spacing.normal", "menu.spacing.loose"];

const DEFAULTS: FontSettings = { size: 20, serif: true, spacing: 1.5 };
const KEY = "naknigu.book.font";

/** Разбирает сохранённую запись; всё непонятное заменяет значениями по умолчанию. */
export function parseFont(raw: string | null): FontSettings {
  try {
    const saved = JSON.parse(raw || "null") as Partial<FontSettings> | null;
    if (saved && typeof saved === "object") {
      return {
        size: typeof saved.size === "number" ? clamp(saved.size, SIZE.min, SIZE.max) : DEFAULTS.size,
        serif: saved.serif !== false,
        spacing: SPACINGS.indexOf(saved.spacing as number) >= 0 ? (saved.spacing as number) : DEFAULTS.spacing,
      };
    }
  } catch {
    /* испорченная запись — берём значения по умолчанию */
  }
  return { size: DEFAULTS.size, serif: DEFAULTS.serif, spacing: DEFAULTS.spacing };
}

export function loadFont(): FontSettings {
  return parseFont(store.get(KEY));
}

export function saveFont(font: FontSettings): void {
  store.set(KEY, JSON.stringify(font));
}

export function fontFamily(font: FontSettings): string {
  return font.serif ? 'Bookerly, Georgia, "Times New Roman", serif' : 'Helvetica, Arial, "Segoe UI", sans-serif';
}

const SWIPE_KEY = "naknigu.book.swipe";
const ROTATION_KEY = "naknigu.book.rotation";

/**
 * Каким движением листают страницы. По умолчанию вертикальным:
 * горизонтальный свайп браузеры некоторых книг забирают себе под «назад/вперёд».
 */
export let swipe: Swipe = store.get(SWIPE_KEY) === "horizontal" ? "horizontal" : "vertical";

/** На сколько градусов по часовой стрелке повёрнут экран. */
export let rotation: Rotation = ROTATIONS[ROTATIONS.indexOf(Number(store.get(ROTATION_KEY)) as Rotation)] || 0;

/** Настройки выбирают в меню книги. */
export function setSwipe(value: Swipe): void {
  swipe = value;
  store.set(SWIPE_KEY, value);
}

export function setRotation(value: Rotation): void {
  rotation = value;
  store.set(ROTATION_KEY, String(value));
}

/**
 * Телефон помнит настройки книги и присылает их с каждым сообщением.
 * Книга берёт их, только если своих у неё нет — новая книга или очищенная
 * память. true — поворот изменился и страницу нужно разложить заново.
 */
export function restoreSettings(message: { swipe?: unknown; rotate?: unknown }): boolean {
  if (store.get(SWIPE_KEY) === null && (message.swipe === "vertical" || message.swipe === "horizontal")) {
    setSwipe(message.swipe);
  }
  if (store.get(ROTATION_KEY) === null && ROTATIONS.indexOf(message.rotate as Rotation) >= 0) {
    setRotation(message.rotate as Rotation);
    return true;
  }
  return false;
}
