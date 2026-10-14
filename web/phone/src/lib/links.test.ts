import { describe, expect, it } from "vitest";
import { guessByUrl } from "./links";

describe("guessByUrl", () => {
  it.each([
    // Статья Habr открывается всегда.
    ["https://habr.com/ru/articles/891426/", true],
    // Файлы и не-страницы статьёй не открыть.
    ["https://example.com/paper.pdf", false],
    ["https://example.com/img/Photo.JPG?size=big", false],
    ["mailto:someone@example.com", false],
    ["не адрес", false],
    // Обычную страницу надо скачать и посмотреть.
    ["https://go.dev/blog/swisstable", null],
    ["https://example.com/docs/pdf", null],
  ])("%s → %s", (url, want) => {
    expect(guessByUrl(url)).toBe(want);
  });
});
