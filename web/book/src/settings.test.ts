import { describe, expect, it } from "vitest";
import { parseFont } from "./settings";

describe("parseFont", () => {
  it.each([
    ["пусто", null, { size: 20, serif: true, spacing: 1.5 }],
    ["мусор", "{не json", { size: 20, serif: true, spacing: 1.5 }],
    ["сохранённые значения", '{"size":26,"serif":false,"spacing":1.7}', { size: 26, serif: false, spacing: 1.7 }],
    ["размер вне границ", '{"size":500,"serif":true,"spacing":1.3}', { size: 40, serif: true, spacing: 1.3 }],
    ["неизвестный интервал", '{"size":18,"spacing":9}', { size: 18, serif: true, spacing: 1.5 }],
  ])("%s", (_name, raw, want) => {
    expect(parseFont(raw)).toEqual(want);
  });
});
