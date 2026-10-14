// Арифметика разбивки на экраны — без обращения к странице, чтобы её
// можно было проверить тестами.
import type { Rotation, Swipe } from "../../shared/protocol";

/**
 * Межстрочный интервал в пикселях, при котором на экран ложится целое число
 * строк: сплошной текст тогда заполняет экран до самого низа.
 */
export function lineHeight(pageHeight: number, fontSize: number, spacing: number): number {
  const lines = Math.max(1, Math.round(pageHeight / (fontSize * spacing)));
  return pageHeight / lines;
}

/** Число экранов по полной ширине разложенного текста. */
export function pageCount(flowWidth: number, viewWidth: number): number {
  return Math.max(1, Math.ceil((flowWidth - 1) / viewWidth));
}

/**
 * Экран, на котором находится блок. left — координата блока на странице,
 * уже сдвинутой на текущий экран, поэтому сдвиг возвращается обратно.
 */
export function pageOf(left: number, currentPage: number, viewWidth: number): number {
  return Math.max(0, Math.floor((left + currentPage * viewWidth + 1) / viewWidth));
}

/** Доля прочитанного в процентах. */
export function percent(page: number, pages: number): number {
  return pages > 1 ? Math.round((page / (pages - 1)) * 100) : 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Короче этого движение пальца — нажатие, а не листание, px. */
const SWIPE_MIN = 60;

/**
 * Куда листать после движения пальца на (dx, dy): 1 — вперёд, -1 — назад,
 * 0 — это не листание. Вверх и влево — вперёд, как при прокрутке и в книге.
 * Движение поперёк выбранной оси не считается: в браузерах некоторых книг
 * горизонтальный свайп — это «назад/вперёд» по истории.
 */
export function swipeTurn(dx: number, dy: number, swipe: Swipe): number {
  const along = swipe === "vertical" ? dy : dx;
  const across = swipe === "vertical" ? dx : dy;
  if (Math.abs(along) < SWIPE_MIN || Math.abs(along) <= Math.abs(across)) {
    return 0;
  }
  return along < 0 ? 1 : -1;
}

/** Прямоугольник на экране, как его сообщает браузер. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Левый край прямоугольника в координатах повёрнутой страницы. Браузер
 * сообщает координаты относительно экрана устройства; при повороте
 * страницы её «лево» — это верх, право или низ экрана (w, h — его размер).
 */
export function localLeft(box: Box, rotation: Rotation, w: number, h: number): number {
  return rotation === 90 ? box.top : rotation === 180 ? w - box.right : rotation === 270 ? h - box.bottom : box.left;
}

/** Верхний край прямоугольника в координатах повёрнутой страницы. */
export function localTop(box: Box, rotation: Rotation, w: number, h: number): number {
  return rotation === 90 ? w - box.right : rotation === 180 ? h - box.bottom : rotation === 270 ? box.left : box.top;
}

/** Движение пальца (dx, dy) по экрану устройства — в координатах повёрнутой страницы. */
export function localMove(dx: number, dy: number, rotation: Rotation): [number, number] {
  return rotation === 90 ? [dy, -dx] : rotation === 180 ? [-dx, -dy] : rotation === 270 ? [-dy, dx] : [dx, dy];
}
