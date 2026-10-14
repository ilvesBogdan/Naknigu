// Библиотека статей в хранилище браузера телефона.
import type { Article, Progress } from "../../../shared/protocol";
import { store } from "../../../shared/storage";

/**
 * Запись списка: статья без текста плюс место чтения. Текст лежит отдельно
 * (naknigu.phone.html.<id>), чтобы список оставался маленьким; пока статью
 * не открывали, текста может не быть.
 */
export interface Saved extends Omit<Article, "html"> {
  anchor: number;
  percent: number;
}

const LIST_KEY = "naknigu.phone.articles";
const htmlKey = (id: string) => "naknigu.phone.html." + id;

/** С чего начинается список у нового пользователя. */
const STARTER: Saved[] = [
  {
    id: "https://habr.com/ru/articles/891426/",
    title: "Планировщик Go — самый подробный гайд простым языком",
    byline: "Николай Тузов",
    published: "2025-03-17T16:56:46+00:00",
    readingTime: 27,
    sourceUrl: "https://habr.com/ru/articles/891426/",
    anchor: 0,
    percent: 0,
  },
];

export function readList(): Saved[] {
  const raw = store.get(LIST_KEY);
  if (raw === null) {
    return STARTER.map((item) => ({ ...item }));
  }
  try {
    return JSON.parse(raw) as Saved[];
  } catch {
    return [];
  }
}

export function writeList(list: Saved[]): void {
  store.set(LIST_KEY, JSON.stringify(list));
}

/** Ищет статью по адресу, под которым её добавили, или по итоговому адресу. */
export function findByUrl(list: Saved[], url: string): Saved | undefined {
  return list.find((item) => item.id === url || item.sourceUrl === url);
}

/**
 * Добавляет статью в начало списка или обновляет её данные, сохраняя место
 * чтения. Возвращает новый список.
 */
export function upsert(list: Saved[], article: Article): Saved[] {
  const { html: _html, ...meta } = article;
  const existing = list.find((item) => item.id === article.id);
  if (existing) {
    return list.map((item) => (item === existing ? { ...item, ...meta } : item));
  }
  return [{ ...meta, anchor: 0, percent: 0 }, ...list];
}

export function withProgress(list: Saved[], progress: Progress): Saved[] {
  return list.map((item) =>
    item.id === progress.articleId ? { ...item, anchor: progress.anchor, percent: progress.percent } : item,
  );
}

/** Сохраняет текст статьи. false — хранилище переполнено. */
export function writeHtml(id: string, html: string): boolean {
  return store.set(htmlKey(id), html);
}

export function readHtml(id: string): string | null {
  return store.get(htmlKey(id));
}

export function removeHtml(id: string): void {
  store.remove(htmlKey(id));
}
