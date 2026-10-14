import { describe, expect, it } from "vitest";
import type { Article } from "../../../shared/protocol";
import { type Saved, findByUrl, upsert, withProgress } from "./library";

const article: Article = {
  id: "https://go.dev/blog/swisstable",
  title: "Swiss Tables",
  byline: "Michael Pratt",
  published: "",
  readingTime: 12,
  sourceUrl: "https://go.dev/blog/swisstable",
  html: "<p>text</p>",
};
const saved: Saved = { ...article, anchor: 59, percent: 15 } as Saved;

describe("upsert", () => {
  it("новая статья встаёт в начало списка без текста и с нулевым прогрессом", () => {
    const list = upsert([{ ...saved, id: "other", sourceUrl: "other" }], article);
    expect(list.map((item) => item.id)).toEqual([article.id, "other"]);
    expect(list[0]).toMatchObject({ anchor: 0, percent: 0 });
    expect(list[0]).not.toHaveProperty("html");
  });
  it("повторная загрузка обновляет данные, но не место чтения", () => {
    const list = upsert([saved], { ...article, title: "Faster Go maps" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Faster Go maps", anchor: 59, percent: 15 });
  });
});

it("withProgress меняет только свою статью", () => {
  const other = { ...saved, id: "other" };
  const list = withProgress([saved, other], { articleId: saved.id, anchor: 70, percent: 20 });
  expect(list[0]).toMatchObject({ anchor: 70, percent: 20 });
  expect(list[1]).toMatchObject({ anchor: 59, percent: 15 });
});

it("findByUrl ищет и по адресу добавления, и по итоговому адресу", () => {
  const moved = { ...saved, id: "https://short.link/x" };
  expect(findByUrl([moved], "https://short.link/x")).toBe(moved);
  expect(findByUrl([moved], "https://go.dev/blog/swisstable")).toBe(moved);
  expect(findByUrl([moved], "https://example.com/")).toBeUndefined();
});
