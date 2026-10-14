// Хранилище браузера может быть недоступно (приватный режим, переполнение),
// поэтому все обращения к нему идут через эту обёртку и не бросают ошибок.
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** Возвращает false, если записать не удалось. */
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* удалять нечего */
    }
  },
};
