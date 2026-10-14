// Состояние и поведение приложения телефона. Компоненты только показывают
// это состояние и вызывают его методы.
import { CodedError, type Received, isNewer, isSessionId, next, publish } from "../../../shared/api";
import { type Args, type Article, type BookMessage, type PhoneMessage, ROTATIONS, type Rotation, type Swipe } from "../../../shared/protocol";
import { store } from "../../../shared/storage";
import { currentLang, t } from "./i18n.svelte";
import { type Saved, findByUrl, readHtml, readList, removeHtml, upsert, withProgress, writeHtml, writeList } from "./library";
import { loadArticle } from "./loader";
import { normalizeUrl, sharedUrl } from "./url";

const SESSION_KEY = "naknigu.phone.session";
const VERSION_KEY = "naknigu.phone.version";
const SWIPE_KEY = "naknigu.phone.swipe";
const ROTATE_KEY = "naknigu.phone.rotate";
/** Статья, открытая сейчас на книге. */
const OPENED_KEY = "naknigu.phone.opened";
/** Ключ доступа прежних версий: сервер его больше не спрашивает, стираем. */
const OLD_ACCESS_KEY = "naknigu.phone.key";
/**
 * Сессия книги, которой ещё не сообщили о связи: код отсканировали, а
 * сообщение не дошло (например, не было сети). Помнится, чтобы повторить
 * его при следующем запуске.
 */
const PAIR_PENDING_KEY = "naknigu.phone.pair_pending";
/** Просьба книги открыть ссылку старше этого уже не нужна, мс. */
const LINK_FRESH_MS = 10 * 60 * 1000;

/** Текст для показа: ключ словаря и подстановки. Переводится при отрисовке. */
export interface Text {
  key: string;
  args?: Args;
}

/** Код ошибки и её подстановки — для показа через словарь `errors.*`. */
export interface Failure {
  code: string;
  args: Args;
}

/**
 * Системное уведомление о ссылке с книги — если пользователь их разрешил.
 * Нажатие на него открывает ссылку (см. public/sw.js). Уведомления, как
 * и service worker, есть только на HTTPS; без них остаётся строка в приложении.
 */
function notifyLink(url: string): void {
  if ("Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
    void navigator.serviceWorker.ready
      .then((worker) => worker.showNotification(t("link.notification"), { body: url, data: url, tag: "naknigu-link" }))
      .catch(() => undefined);
  }
}

function failureOf(error: unknown): Failure {
  return error instanceof CodedError ? { code: error.code, args: error.args } : { code: "unknown", args: { code: String(error) } };
}

export class PhoneApp {
  articles = $state<Saved[]>(readList());
  /** Идентификатор сессии книги; пустая строка — телефон ни с чем не связан. */
  session = $state("");
  /** Сообщение под заголовком: итог последнего действия. */
  notice = $state<Text | null>(null);
  /** Ошибка последнего действия; показывается вместо notice. */
  failure = $state<Failure | null>(null);
  /** Строки лога загрузки; пустой список — лог скрыт. */
  log = $state<Text[]>([]);
  /** Ссылка, которую на книге попросили открыть на телефоне; пусто — нет. */
  link = $state("");
  /**
   * Настройки книги: способ листания и поворот экрана. Их выбирают в меню
   * книги; телефон только хранит копию и отправляет её с каждым сообщением,
   * чтобы новая книга (или книга с очищенной памятью) получила их обратно.
   * Пока книга ничего не сообщила — их нет, и книга остаётся при своих.
   */
  private swipe: Swipe | undefined = store.get(SWIPE_KEY) === "horizontal" ? "horizontal" : store.get(SWIPE_KEY) === "vertical" ? "vertical" : undefined;
  private rotate: Rotation | undefined = ROTATIONS.find((r) => String(r) === store.get(ROTATE_KEY));

  /** Сообщения книге уходят строго по очереди — см. send(). */
  private outbox: Promise<unknown> = Promise.resolve();
  /** Забирала ли книга хоть одно сообщение текущего действия. */
  private bookListened = false;

  get paired(): boolean {
    return this.session !== "";
  }

  /** Запускает приложение: разбирает код из адреса и начинает слушать книгу. */
  start(): void {
    const saved = store.get(SESSION_KEY) ?? "";
    const scanned = /[#&]s=([a-z0-9]+)/.exec(location.hash)?.[1] ?? "";
    store.remove(OLD_ACCESS_KEY);

    // Связь один к одному: новый код заменяет прежнюю книгу. Статьи
    // и прогресс при этом остаются — они принадлежат телефону, а не книге.
    const isNewBook = isSessionId(scanned) && scanned !== saved;
    this.session = isSessionId(scanned) ? scanned : isSessionId(saved) ? saved : "";
    if (isSessionId(scanned)) {
      store.set(SESSION_KEY, scanned);
      // Убираем код из адреса: при обновлении страницы он не должен сработать заново.
      history.replaceState(null, "", location.pathname);
    }
    if (isNewBook) {
      // У новой книги свой отсчёт версий сообщений, и статья на ней не открыта.
      store.remove(VERSION_KEY);
      store.remove(OPENED_KEY);
      store.set(PAIR_PENDING_KEY, scanned);
      this.sendPaired();
      this.notice = { key: "notice.connected" };
    } else if (this.paired && store.get(PAIR_PENDING_KEY) === this.session) {
      // В прошлый раз сообщение о связи не дошло (не было сети) — повторяем.
      this.sendPaired();
    }

    // Если страница уже открыта, новый код меняет в адресе только часть
    // после «#», и браузер страницу не перезагружает — делаем это сами.
    window.addEventListener("hashchange", () => location.reload());

    void this.syncFromBook().then(() => this.listenToBook());

    // Приложению передали ссылку через меню «Поделиться» (см. public/manifest.json).
    const shared = sharedUrl(new URLSearchParams(location.search));
    if (location.search) {
      // Убираем её из адреса: обновление страницы не должно добавить статью заново.
      history.replaceState(null, "", location.pathname);
    }
    if (shared) {
      void this.add(shared);
    }
  }

  /** Сообщает книге, что её код отсканирован: она уберёт его с экрана. */
  private sendPaired(): void {
    const session = this.session;
    void this.send({ type: "paired" }).then(
      () => {
        if (store.get(PAIR_PENDING_KEY) === session) {
          store.remove(PAIR_PENDING_KEY);
        }
      },
      () => undefined,
    );
  }

  // --- Связь с книгой ---

  /**
   * Отправляет сообщение книге. Очередь нужна, чтобы строка лога не обогнала
   * саму статью и не закрыла её собой. null — телефон ни с чем не связан.
   */
  private send(message: BookMessage): Promise<{ listeners: number } | null> {
    if (!this.paired) {
      return Promise.resolve(null);
    }
    const target = this.session;
    // Язык и настройки берём в момент отправки: книга перенимает их.
    const sent = this.outbox.then(() =>
      publish(target, "book", { ...message, lang: currentLang(), swipe: this.swipe, rotate: this.rotate }),
    );
    this.outbox = sent.then(
      (result) => {
        this.bookListened ||= result.listeners > 0;
      },
      () => undefined,
    );
    return sent;
  }

  private applyFromBook(received: Received<PhoneMessage> | null): void {
    if (!received || !isNewer(received.version, store.get(VERSION_KEY) ?? "0")) {
      return;
    }
    store.set(VERSION_KEY, received.version);
    const message = received.message;
    // Книга сообщает свои настройки в каждом сообщении — запоминаем.
    if (message.swipe === "vertical" || message.swipe === "horizontal") {
      this.swipe = message.swipe;
      store.set(SWIPE_KEY, message.swipe);
    }
    const rotate = ROTATIONS.find((r) => r === message.rotate);
    if (rotate !== undefined) {
      this.rotate = rotate;
      store.set(ROTATE_KEY, String(rotate));
    }
    // Версия — время сервера в наносекундах. Старую просьбу (приложение
    // открыли на другой день) не выполняем. И открываем только адреса страниц.
    const fresh = Date.now() - Number(received.version.slice(0, -6)) < LINK_FRESH_MS;
    if (message.type === "link" && fresh && /^https?:\/\//i.test(message.url)) {
      if (message.article) {
        void this.openLink(message.url);
      } else {
        this.link = message.url;
        notifyLink(message.url);
      }
    }
    // Прогресс лежит либо сам по себе, либо внутри сообщения о ссылке,
    // настройках или выходе.
    const progress = message.type === "progress" ? message : message.progress;
    if (progress) {
      this.articles = withProgress(this.articles, progress);
      writeList(this.articles);
    }
    if (message.type === "unpaired") {
      // На книге нажали «Выйти»: забываем её, статьи и прогресс оставляем.
      this.session = "";
      store.remove(SESSION_KEY);
      store.remove(VERSION_KEY);
      store.remove(OPENED_KEY);
    }
  }

  /** Забирает то, что книга прислала, пока страница была закрыта. */
  private syncFromBook(): Promise<void> {
    if (!this.paired) {
      return Promise.resolve();
    }
    return next<PhoneMessage>(this.session, "phone", "0", false).then(
      (received) => this.applyFromBook(received),
      () => undefined,
    );
  }

  private listenToBook(): void {
    if (!this.paired) {
      return;
    }
    next<PhoneMessage>(this.session, "phone", store.get(VERSION_KEY) ?? "0", true)
      .then((received) => this.applyFromBook(received))
      .then(
        () => this.listenToBook(),
        // Сеть пропала или сервер перезапускается — пробуем позже.
        () => setTimeout(() => this.listenToBook(), 3000),
      );
  }

  // --- Действия пользователя ---

  private remember(article: Article): void {
    this.articles = upsert(this.articles, article);
    writeList(this.articles);
    if (!writeHtml(article.id, article.html)) {
      this.notice = { key: "notice.storage_full" };
    }
  }

  private begin(first: Text): void {
    this.notice = null;
    this.failure = null;
    this.log = [first];
  }

  /** Открывает статью на книге с места, где чтение остановилось. */
  async open(id: string): Promise<void> {
    const item = this.articles.find((a) => a.id === id);
    if (!item) {
      return;
    }
    // Каждый шаг виден и на телефоне, и на книге.
    const step = (key: string, args?: Args) => {
      this.log.push({ key: "status." + key, args });
      void this.send({ type: "status", key, args }).catch(() => undefined);
    };

    this.bookListened = false;
    this.begin({ key: "status.opening", args: { title: item.title } });
    void this.send({ type: "status", key: "opening", args: { title: item.title } }).catch(() => undefined);
    try {
      await this.syncFromBook();
      const html = readHtml(item.id);
      let article: Article;
      if (html) {
        step("from_storage");
        article = { ...item, html };
      } else {
        // Запись в списке остаётся той же, под каким бы адресом статья ни пришла.
        article = { ...(await loadArticle(item.sourceUrl, step)), id: item.id };
      }
      this.remember(article);
      this.log.push({ key: "status.sending" });
      const anchor = this.articles.find((a) => a.id === item.id)?.anchor ?? 0;
      // Запоминаем до отправки: настройки, изменённые в эту секунду, должны
      // уйти уже с этой статьёй, а не с прежней.
      store.set(OPENED_KEY, item.id);
      const result = await this.send({ type: "article", article, anchor });
      await this.outbox;
      if (!result) {
        this.notice = { key: "notice.saved_unpaired" };
      } else if (!this.bookListened) {
        // Книга на связи, если забрала хотя бы одно сообщение: между двумя
        // запросами ожидания она на мгновение «не слушает», и судить
        // по одному только последнему сообщению нельзя. Когда статья дошла,
        // сообщения нет: её и так видно на книге.
        this.notice = { key: "notice.offline" };
      }
    } catch (error) {
      this.failure = failureOf(error);
      void this.send({ type: "error", code: this.failure.code, args: this.failure.args }).catch(() => undefined);
    } finally {
      this.log = [];
    }
  }

  /**
   * На книге нажали на ссылку и выбрали «Открыть как статью»: добавляем
   * страницу в список, если её там нет, и открываем на книге.
   */
  private async openLink(input: string): Promise<void> {
    // Часть после «#» — место на странице, а не другая статья.
    const item = await this.find(input.split("#")[0]);
    if (item) {
      await this.open(item.id);
      return;
    }
    // Книга ждёт ответа: говорим ей, что не вышло. Ошибку отправляем вместе
    // с открытой статьёй — отдельное сообщение заняло бы её место в канале,
    // и после перезагрузки книга осталась бы без статьи.
    const error = this.failure ?? { code: "not_readerable", args: {} };
    const opened = this.opened();
    const message: BookMessage = opened
      ? { type: "article", article: opened.article, anchor: opened.anchor, error }
      : { type: "error", code: error.code, args: error.args };
    void this.send(message).catch(() => undefined);
  }

  /** Статья, открытая сейчас на книге, вместе с текстом. */
  private opened(): { article: Article; anchor: number } | null {
    const item = this.articles.find((a) => a.id === store.get(OPENED_KEY));
    const html = item ? readHtml(item.id) : null;
    return item && html ? { article: { ...item, html }, anchor: item.anchor } : null;
  }

  /** Добавляет статью по ссылке. true — статья добавлена. */
  async add(input: string): Promise<boolean> {
    const before = this.articles.length;
    return (await this.find(input)) !== null && this.articles.length > before;
  }

  /**
   * Возвращает статью по ссылке: уже сохранённую или только что добавленную.
   * null — добавить не удалось, причина в failure.
   */
  private async find(input: string): Promise<Saved | null> {
    const url = normalizeUrl(input);
    this.notice = null;
    this.failure = null;
    if (!url) {
      this.failure = { code: "bad_url", args: {} };
      return null;
    }
    const known = findByUrl(this.articles, url);
    if (known) {
      this.notice = { key: "notice.already" };
      return known;
    }
    this.begin({ key: "log.adding", args: { url } });
    try {
      const article = await loadArticle(url, (key) => this.log.push({ key: "status." + key }));
      // Та же статья могла быть добавлена раньше под другим адресом.
      const same = findByUrl(this.articles, article.sourceUrl);
      if (same) {
        this.notice = { key: "notice.already" };
        return same;
      }
      this.remember(article);
      this.notice ??= { key: this.paired ? "notice.saved" : "notice.saved_unpaired" };
      return findByUrl(this.articles, article.id) ?? null;
    } catch (error) {
      this.failure = failureOf(error);
      return null;
    } finally {
      this.log = [];
    }
  }

  remove(id: string): void {
    if (store.get(OPENED_KEY) === id) {
      store.remove(OPENED_KEY);
    }
    this.articles = this.articles.filter((a) => a.id !== id);
    writeList(this.articles);
    removeHtml(id);
  }
}
