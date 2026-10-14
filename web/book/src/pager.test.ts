import { describe, expect, it } from "vitest";
import { clamp, lineHeight, localLeft, localMove, localTop, pageCount, pageOf, percent, swipeTurn } from "./pager";

describe("lineHeight", () => {
  it.each([
    // высота экрана, шрифт, интервал → строк на экране
    [648, 20, 1.5, 22],
    [648, 26, 1.5, 17],
    [700, 20, 1.3, 27],
    [10, 40, 1.7, 1],
  ])("экран %i, шрифт %i×%f → %i строк", (height, font, spacing, lines) => {
    // Целое число строк занимает экран без остатка.
    expect(lineHeight(height, font, spacing) * lines).toBeCloseTo(height, 6);
  });
});

describe("pageCount", () => {
  it.each([
    [0, 536, 1],
    [516, 536, 1],
    [536, 536, 1],
    [537.5, 536, 2],
    [1052, 536, 2],
    [67536, 536, 126],
  ])("ширина текста %f при экране %i → %i", (flow, view, want) => {
    expect(pageCount(flow, view)).toBe(want);
  });
});

describe("pageOf", () => {
  it.each([
    // left блока, текущий экран, ширина экрана → экран блока
    [20, 0, 536, 0],
    [556, 0, 536, 1],
    [20, 7, 536, 7],
    [-516, 7, 536, 6],
    [1092, 7, 536, 9],
    [-9999, 0, 536, 0],
  ])("left %i на экране %i → %i", (left, page, view, want) => {
    expect(pageOf(left, page, view)).toBe(want);
  });
});

describe("percent", () => {
  it.each([
    [0, 1, 100],
    [0, 11, 0],
    [5, 11, 50],
    [10, 11, 100],
  ])("экран %i из %i → %i%%", (page, pages, want) => {
    expect(percent(page, pages)).toBe(want);
  });
});

it("clamp держит значение в границах", () => {
  expect(clamp(5, 14, 40)).toBe(14);
  expect(clamp(99, 14, 40)).toBe(40);
  expect(clamp(20, 14, 40)).toBe(20);
});

describe("swipeTurn", () => {
  it.each([
    // dx, dy, настройка → куда листать
    [0, -100, "vertical", 1],
    [0, 100, "vertical", -1],
    [30, -100, "vertical", 1],
    // Горизонтальное движение при вертикальной настройке — не листание.
    [-200, 10, "vertical", 0],
    [-100, 0, "horizontal", 1],
    [100, 0, "horizontal", -1],
    [10, -200, "horizontal", 0],
    // Короткое движение — это нажатие.
    [0, -40, "vertical", 0],
    // По диагонали — непонятно куда, не листаем.
    [-100, -100, "vertical", 0],
  ] as const)("(%i, %i), %s → %i", (dx, dy, swipe, want) => {
    expect(swipeTurn(dx, dy, swipe)).toBe(want);
  });
});

describe("поворот страницы", () => {
  // Экран 600×800; прямоугольник стоит в 10 px от левого края страницы
  // и в 20 px от её верха, размер 100×50 в координатах страницы.
  const w = 600;
  const h = 800;
  it.each([
    [0, { left: 10, top: 20, right: 110, bottom: 70 }],
    [90, { left: 530, top: 10, right: 580, bottom: 110 }],
    [180, { left: 490, top: 730, right: 590, bottom: 780 }],
    [270, { left: 20, top: 690, right: 70, bottom: 790 }],
  ] as const)("поворот %i°: координаты экрана → координаты страницы", (rotation, box) => {
    expect(localLeft(box, rotation, w, h)).toBe(10);
    expect(localTop(box, rotation, w, h)).toBe(20);
  });

  it.each([
    // Палец идёт по экрану устройства вниз на 100 px.
    [0, [0, 100]],
    [90, [100, -0]],
    [180, [-0, -100]],
    [270, [-100, 0]],
  ] as const)("поворот %i°: движение вниз по экрану", (rotation, want) => {
    expect(localMove(0, 100, rotation)).toEqual(want);
  });

  it.each([
    // Палец идёт по экрану устройства вправо на 100 px.
    [0, [100, 0]],
    [90, [0, -100]],
    [180, [-100, -0]],
    [270, [-0, 100]],
  ] as const)("поворот %i°: движение вправо по экрану", (rotation, want) => {
    expect(localMove(100, 0, rotation)).toEqual(want);
  });
});
