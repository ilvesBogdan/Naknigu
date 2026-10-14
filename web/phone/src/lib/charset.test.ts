import { describe, expect, it } from "vitest";
import { decodePage, detectCharset } from "./charset";

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("detectCharset", () => {
  it.each([
    ["заголовок", "text/html; charset=windows-1251", '<html lang="ru">', "windows-1251"],
    ["заголовок в кавычках", 'text/html; charset="KOI8-R"', '<html lang="ru">', "koi8-r"],
    ["meta charset", "text/html", '<head><meta charset="windows-1251">', "windows-1251"],
    ["meta http-equiv", null, '<meta http-equiv="Content-Type" content="text/html; charset=koi8-r">', "koi8-r"],
    ["заголовок важнее meta", "text/html; charset=utf-8", '<meta charset="windows-1251">', "utf-8"],
    ["нигде не указана", "text/html", '<html lang="ru"><body>', "utf-8"],
  ])("%s", (_name, contentType, head, want) => {
    expect(detectCharset(contentType, ascii(head))).toBe(want);
  });
});

describe("decodePage", () => {
  it("читает windows-1251", () => {
    const bytes = Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodePage("text/html; charset=windows-1251", bytes)).toBe("Привет");
  });
  it("неизвестную кодировку читает как UTF-8", () => {
    expect(decodePage("text/html; charset=no-such-charset", new TextEncoder().encode("Привет"))).toBe("Привет");
  });
});
