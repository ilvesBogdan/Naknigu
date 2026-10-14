// Мелкие помощники для работы со страницей.
import { localLeft, localTop } from "./pager";
import { rotation } from "./settings";

/** Элемент по id. Его отсутствие — ошибка вёрстки, а не штатная ситуация. */
export function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error("missing element #" + id);
  }
  return el;
}

/** Экраны книги переключаются классом на <body>; остальное делает CSS. */
export type Screen = "pairing" | "reading" | "menu";

export function show(screen: Screen): void {
  document.body.className = screen;
}

export function shown(): Screen {
  return document.body.className as Screen;
}

/**
 * Подгоняет страницу под экран: размер, шрифт интерфейса и поворот.
 *
 * Размер #screen задаётся в пикселях, а всё внутри расположено относительно
 * него — так вёрстка одинакова на любом экране и при любом повороте.
 *
 * Шрифт интерфейса (меню, экран связывания, панель листания) зависит
 * от меньшей стороны экрана: 20 px на экране шириной около 640 px, как
 * у распространённых 6-дюймовых книг, и пропорционально меньше или больше на других книгах. Размер
 * текста статьи читатель выбирает сам, на него это не влияет.
 */
export function fitScreen(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const size = pageSize();
  const style = byId("screen").style;
  document.body.style.fontSize = Math.max(13, Math.min(28, Math.round(Math.min(w, h) / 32))) + "px";
  style.width = size[0] + "px";
  style.height = size[1] + "px";
  // Блок поворачивается вокруг левого верхнего угла и сдвигается обратно в экран.
  style.transform = rotation
    ? "translate(" + (rotation < 270 ? w : 0) + "px," + (rotation > 90 ? h : 0) + "px) rotate(" + rotation + "deg)"
    : "";
}

/** Ширина и высота страницы с учётом поворота. */
export function pageSize(): [number, number] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return rotation === 90 || rotation === 270 ? [h, w] : [w, h];
}

/** Левый и верхний край элемента (или его части) в координатах повёрнутой страницы. */
export function left(box: DOMRect): number {
  return localLeft(box, rotation, window.innerWidth, window.innerHeight);
}
export function top(box: DOMRect): number {
  return localTop(box, rotation, window.innerWidth, window.innerHeight);
}
