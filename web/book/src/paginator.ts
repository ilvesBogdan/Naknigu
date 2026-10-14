// Разбивка статьи на экраны.
//
// Текст раскладывается в CSS-колонки шириной и высотой ровно с экран; один
// экран — одна колонка. Браузер сам следит, чтобы строка не разрывалась
// между колонками, поэтому половинок строк у края экрана не бывает.
import { byId, left, top } from "./dom";
import { lineHeight, pageCount, pageOf, percent } from "./pager";
import { type FontSettings, fontFamily } from "./settings";

/**
 * Блоки текста, по которым запоминается место чтения. Номер блока надёжнее
 * номера экрана: он не зависит от размера шрифта и ещё не загруженных картинок.
 */
const BLOCKS = "p,h2,h3,h4,li,pre,figure,blockquote,table";

const SIDE_PADDING = 20; // поля слева и справа, px
const TOP_PADDING = 12; // поля сверху и снизу, px

export class Paginator {
  /** Блок, с которого начинается текущий экран. */
  anchor = 0;
  /**
   * На сколько экранов текущий экран дальше начала блока anchor. Длинный
   * блок (код, таблица) занимает несколько экранов; без этой поправки
   * повторная раскладка возвращала бы к его первому экрану.
   */
  private offset = 0;
  /** Текущий экран (с нуля) и число экранов. */
  page = 0;
  pages = 1;
  private list: ArrayLike<HTMLElement> = [];

  private get view(): HTMLElement {
    return byId("page");
  }

  /** Новая статья уже в разметке: запоминает её блоки и место чтения. */
  open(anchor: number): void {
    this.list = byId("content").querySelectorAll<HTMLElement>(BLOCKS);
    this.anchor = anchor;
    this.offset = 0;
  }

  /** Пересчитывает колонки под экран и шрифт и возвращается к месту чтения. */
  reflow(font: FontSettings): void {
    const flow = byId("flow");
    const width = this.view.clientWidth;
    // Высота места под текст: от верха экрана до панели листания.
    //
    // Собственной высоте #page верить нельзя. Браузер книги (старый Chromium)
    // после перезагрузки страницы не ограничивает её свойством bottom, и #page
    // растягивается на весь текст — десятки тысяч пикселей. Колонки тогда
    // выходят той же высоты: вся статья «умещается» в 2–3 экрана, а нижние
    // строки уходят под панель. Поэтому высоту считаем по панели, которая
    // всегда стоит на месте, и задаём её #page явно.
    const available = Math.floor(top(byId("pager").getBoundingClientRect()) - top(this.view.getBoundingClientRect()));
    const height = available - 2 * TOP_PADDING;
    if (width <= 0 || height <= 0) {
      return; // экран чтения сейчас скрыт
    }
    const line = lineHeight(height, font.size, font.spacing);

    this.view.style.height = available + "px";
    // Замеры ниже считают координаты от первого экрана.
    this.page = 0;
    flow.style.transform = "none";
    flow.style.fontFamily = fontFamily(font);
    flow.style.fontSize = font.size + "px";
    flow.style.lineHeight = line + "px";
    flow.style.height = height + "px";
    flow.style.padding = TOP_PADDING + "px " + SIDE_PADDING + "px";
    flow.style.columnWidth = width - 2 * SIDE_PADDING + "px";
    flow.style.columnGap = 2 * SIDE_PADDING + "px";
    // Картинка не должна быть выше экрана, иначе её разрежет.
    flow.style.setProperty("--page-height", height + "px");
    flow.style.setProperty("--line-height", line + "px");

    // Браузер иногда заводит в конце лишнюю пустую колонку (под отступ
    // последнего абзаца). Статья кончается там, где кончается её последняя
    // строка — «Источник», — экраны после неё не считаем.
    const end = byId("source").getClientRects();
    const last = end.length ? pageOf(left(end[end.length - 1]), 0, width) + 1 : Infinity;
    this.pages = Math.min(pageCount(flow.scrollWidth, width), last);
    // Поправка не уводит дальше конца блока: после смены шрифта он может
    // занимать меньше экранов, чем раньше. За последним блоком идёт только
    // строка «Источник» — там ограничивать нечем.
    const limit = this.anchor < this.list.length - 1 ? this.pageOfBlock(this.anchor, true) : Infinity;
    this.goTo(Math.min(this.pageOfBlock(this.anchor) + this.offset, limit));
  }

  /** Листает на direction экранов и запоминает новое место чтения. */
  turn(direction: number): void {
    this.goTo(this.page + direction);
    this.anchor = this.firstBlockOnPage();
    this.offset = this.page - this.pageOfBlock(this.anchor);
  }

  /** Открывает экран, на котором начинается элемент статьи (заголовок). */
  show(el: Element): void {
    const rect = el.getClientRects()[0];
    if (rect) {
      this.turn(pageOf(left(rect), this.page, this.view.clientWidth) - this.page);
    }
  }

  percent(): number {
    return percent(this.page, this.pages);
  }

  private goTo(target: number): void {
    this.page = Math.max(0, Math.min(this.pages - 1, target));
    // Без анимации: e-ink перерисовывает экран целиком.
    byId("flow").style.transform = "translateX(" + -this.page * this.view.clientWidth + "px)";
    byId("pageno").textContent = this.page + 1 + " / " + this.pages;
  }

  /** Экран, на котором блок начинается (или, с last, заканчивается). */
  private pageOfBlock(block: number, last?: boolean): number {
    const rects = block > 0 && this.list[block] ? this.list[block].getClientRects() : [];
    const rect = rects[last ? rects.length - 1 : 0];
    return rect ? pageOf(left(rect), this.page, this.view.clientWidth) : last ? Infinity : 0;
  }

  /** Левый край начала блока на экране; у скрытого блока его нет. */
  private startOf(block: number): number | undefined {
    const rect = this.list[block].getClientRects()[0];
    return rect && left(rect);
  }

  /**
   * Первый блок, который начинается на текущем экране. Если такого нет
   * (экран целиком занят продолжением длинного блока) — этот длинный блок.
   *
   * Поиск идёт от прежнего места чтения, а не от начала статьи: браузер книги
   * медленный, а спрашивать у него положение сотен блоков на каждое
   * перелистывание дорого.
   */
  private firstBlockOnPage(): number {
    const width = this.view.clientWidth;
    let i = Math.min(this.anchor, this.list.length - 1);
    // Отступаем к блоку, который начался до текущего экрана...
    for (; i > 0; i--) {
      const x = this.startOf(i);
      if (x !== undefined && x < 0) {
        break;
      }
    }
    // ...и идём вперёд до первого, который начинается на экране.
    let spanning = Math.max(i, 0);
    for (i = spanning; i < this.list.length; i++) {
      const x = this.startOf(i);
      if (x === undefined) {
        continue;
      }
      if (x >= width) {
        break;
      }
      if (x >= 0) {
        return i;
      }
      spanning = i;
    }
    return spanning;
  }
}
