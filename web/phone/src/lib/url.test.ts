import { describe, expect, it } from "vitest";
import { habrId, normalizeUrl, sharedUrl, smallImageUrl } from "./url";

describe("normalizeUrl", () => {
  // Адреса http:// здесь — проверяемые данные, а не запросы.
  // noinspection HttpUrlsUsage
  it.each([
    ["891426", "https://habr.com/ru/articles/891426/"],
    ["  go.dev/blog/swisstable ", "https://go.dev/blog/swisstable"],
    ["https://example.com/a?b=1#c", "https://example.com/a?b=1#c"],
    ["HTTP://Example.com", "http://example.com/"],
    ["", ""],
    ["просто текст", ""],
    ["localhost", ""],
    ["12", ""],
  ])("%s → %s", (input, want) => {
    expect(normalizeUrl(input)).toBe(want);
  });
});

describe("habrId", () => {
  it.each([
    ["https://habr.com/ru/articles/891426/", "891426"],
    ["https://habr.com/ru/companies/ozontech/articles/810427/", "810427"],
    ["https://habr.com/ru/post/463441/", "463441"],
    ["https://m.habr.com/ru/articles/891426/?utm=1#comments", "891426"],
    ["https://habr.com/ru/hubs/go/", ""],
    ["https://example.com/articles/891426/", ""],
  ])("%s → %s", (url, want) => {
    expect(habrId(url)).toBe(want);
  });
});

describe("smallImageUrl", () => {
  it.each([
    ["https://habrastorage.org/r/w1560/webt/a/b.png", "https://habrastorage.org/r/w780/webt/a/b.png"],
    ["https://habrastorage.org/r/w780/webt/a/b.png", "https://habrastorage.org/r/w780/webt/a/b.png"],
    ["https://example.com/r/w1560/a.png", "https://example.com/r/w1560/a.png"],
  ])("%s", (src, want) => {
    expect(smallImageUrl(src)).toBe(want);
  });
});

describe("sharedUrl", () => {
  it.each([
    ["url=https%3A%2F%2Fgo.dev%2Fblog%2F", "https://go.dev/blog/"],
    ["title=Go&text=%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F%20https%3A%2F%2Fgo.dev%2Fa%3Fb%3D1%20%D0%B2%D0%BE%D1%82", "https://go.dev/a?b=1"],
    ["title=https%3A%2F%2Fexample.com%2Fx", "https://example.com/x"],
    ["url=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FGo_(programming_language)", "https://en.wikipedia.org/wiki/Go_(programming_language)"],
    ["text=%D0%A1%D0%BC%D0%BE%D1%82%D1%80%D0%B8%20(https%3A%2F%2Fgo.dev%2Fa).", "https://go.dev/a"],
    ["text=%D0%BF%D1%80%D0%BE%D1%81%D1%82%D0%BE%20%D1%82%D0%B5%D0%BA%D1%81%D1%82", ""],
    ["", ""],
  ])("%s → %s", (query, want) => {
    expect(sharedUrl(new URLSearchParams(query))).toBe(want);
  });
});
