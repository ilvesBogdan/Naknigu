import { describe, expect, it } from "vitest";
import { langFromPhone, nextLang, pickLang, translate, translateError } from "./i18n";

const dictionary = {
  "status.opening": "Открываю «{title}»…",
  "errors.timeout": "сайт не ответил вовремя",
  "errors.site_status": "сайт ответил ошибкой {status}",
  "errors.unknown": "неизвестная ошибка ({code})",
};

describe("pickLang", () => {
  it.each([
    ["en", "ru-RU", "en"],
    ["ru", "en-US", "ru"],
    [null, "ru-RU", "ru"],
    [null, "RU", "ru"],
    [null, "de-DE", "en"],
    [null, undefined, "en"],
    ["de", "ru", "ru"],
  ])("сохранено %s, браузер %s → %s", (saved, browser, want) => {
    expect(pickLang(saved, browser)).toBe(want);
  });
});

describe("langFromPhone", () => {
  it.each([
    // язык от телефона, прежний язык телефона → что перенять
    ["en", null, "en"],
    ["ru", "en", "ru"],
    // Тот же язык повторно не навязываем: на книге могли выбрать другой.
    ["en", "en", null],
    // Старый телефон языка не присылает, незнакомый язык не понимаем.
    [undefined, null, null],
    ["de", "ru", null],
  ])("телефон %s, прежде %s → %s", (received, last, want) => {
    expect(langFromPhone(received, last)).toBe(want);
  });
});

describe("translate", () => {
  it("подставляет значения", () => {
    expect(translate(dictionary, "status.opening", { title: "Go" })).toBe("Открываю «Go»…");
  });
  it("оставляет неизвестную подстановку и неизвестный ключ как есть", () => {
    expect(translate(dictionary, "status.opening")).toBe("Открываю «{title}»…");
    expect(translate(dictionary, "no.such.key")).toBe("no.such.key");
  });
});

describe("translateError", () => {
  it("переводит известный код", () => {
    expect(translateError(dictionary, "site_status", { status: 403 })).toBe("сайт ответил ошибкой 403");
  });
  it("показывает незнакомый код через errors.unknown", () => {
    expect(translateError(dictionary, "from_the_future")).toBe("неизвестная ошибка (from_the_future)");
  });
});

it("nextLang переключает по кругу", () => {
  expect(nextLang("ru")).toBe("en");
  expect(nextLang("en")).toBe("ru");
});
