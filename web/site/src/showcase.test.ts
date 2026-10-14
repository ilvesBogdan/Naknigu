// Переводы витрины: у каждого текста разметки есть перевод на оба языка,
// и в словарях нет текстов, которых разметка не использует.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const html = readFileSync(new URL("./showcase.html", import.meta.url), "utf8");
const code = readFileSync(new URL("./showcase.ts", import.meta.url), "utf8");

/** Ключи, которые использует разметка (data-i18n и data-i18n-attr) и код (t("…")). */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) {
    keys.add(m[1]);
  }
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(";")) {
      keys.add(pair.split(":")[1]);
    }
  }
  for (const m of code.matchAll(/(?<![\w.])t\("([\w.]+)"\)/g)) {
    keys.add(m[1]);
  }
  return keys;
}

test("словари витрины совпадают по ключам", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
});

test("у каждого текста разметки есть перевод", () => {
  const missing = [...usedKeys()].filter((key) => !(key in ru) || !(key in en));
  expect(missing).toEqual([]);
});

test("в словарях нет лишних текстов", () => {
  const used = usedKeys();
  const unused = Object.keys(ru).filter((key) => !used.has(key));
  expect(unused).toEqual([]);
});

test("словари не входят в код витрины: скачивается только нужный", () => {
  expect(code).not.toMatch(/from\s+["'][^"']*locales\//);
});

test("тексты витрины не пустые", () => {
  for (const dictionary of [ru, en] as Record<string, string>[]) {
    for (const [key, text] of Object.entries(dictionary)) {
      expect(text.trim(), key).not.toBe("");
    }
  }
});
