// Связь книги с телефоном через сервер: сессия, приём сообщений, отправка.
import { isNewer, isSessionId, newSessionId, next, publish } from "../../shared/api";
import type { BookMessage, PhoneMessage } from "../../shared/protocol";
import { store } from "../../shared/storage";
import { rotation, swipe } from "./settings";

const KEY = "naknigu.book.session";
const PAIRED_KEY = "naknigu.book.paired";

export class Link {
  /**
   * Идентификатор сессии — единственное, что книга помнит о телефоне между
   * запусками: без него код пришлось бы сканировать после каждой перезагрузки.
   */
  session: string;
  /**
   * Телефон уже сканировал код этой сессии. Помнится между запусками:
   * связанная книга при перезагрузке страницы не показывает код заново.
   */
  paired: boolean;
  private version = "0";
  /**
   * Первый запрос связанной книги — без ожидания: так сразу видно, помнит
   * ли сервер последнюю статью, и второй запрос для этого не нужен.
   */
  private probe = false;
  /** Растёт при выходе: цикл ожидания старой сессии замечает это и останавливается. */
  private generation = 0;
  /** Сообщения телефону уходят строго по очереди — см. send(). */
  private outbox: Promise<unknown> = Promise.resolve();

  /**
   * onEmpty вызывается, когда связанная книга при запуске спросила сервер,
   * а вернуть ему нечего. onOffline — когда при запуске до сервера
   * не достучаться (нет сети, сервер выключен); книга при этом продолжает пробовать.
   */
  constructor(
    private readonly onMessage: (message: BookMessage, version: string) => Promise<void>,
    private readonly onEmpty: () => void,
    private readonly onOffline: () => void,
  ) {
    const saved = store.get(KEY) || "";
    this.session = isSessionId(saved) ? saved : newSessionId();
    store.set(KEY, this.session);
    this.paired = isSessionId(saved) && store.get(PAIRED_KEY) === saved;
    this.probe = this.paired;
  }

  /** Запоминает, что телефон связан с этой сессией. */
  markPaired(): void {
    if (!this.paired) {
      this.paired = true;
      store.set(PAIRED_KEY, this.session);
    }
  }

  /**
   * Адрес страницы телефона — он зашит в QR-код. Страница телефона лежит
   * рядом со страницей книги, в папке phone/: на GitHub Pages сайт проекта
   * живёт не в корне, а по адресу https://<имя>.github.io/<проект>/.
   */
  phoneUrl(): string {
    return location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "") + "phone/#s=" + this.session;
  }

  /** Запускает бесконечный приём сообщений от телефона. */
  listen(): void {
    const mine = this.generation;
    const again = (delayMs: number) =>
      setTimeout(() => {
        if (mine === this.generation) {
          this.listen();
        }
      }, delayMs);

    const probe = this.probe;
    this.probe = false;

    next<BookMessage>(this.session, "book", this.version, !probe)
      .then((received) => {
        if (mine !== this.generation) {
          return;
        }
        if (!received) {
          if (probe) {
            this.onEmpty();
          }
          return;
        }
        this.version = received.version;
        return this.onMessage(received.message, received.version);
      })
      .then(
        () => again(0),
        // Ошибка — сеть пропала (книга спала) или сервер перезапускается: пробуем позже.
        () => {
          if (probe && mine === this.generation) {
            // Статью так и не спросили: следующий запрос — снова первый.
            this.probe = true;
            this.onOffline();
          }
          again(3000);
        },
      );
  }

  /**
   * Отправляет сообщение телефону. Очередь нужна потому, что в канале
   * помнится только последнее сообщение: запоздавший прогресс не должен
   * затереть сообщение о выходе.
   */
  send(message: PhoneMessage): void {
    const target = this.session;
    // Не дошло — не страшно: следующее перелистывание отправит свежее значение.
    // Настройки книги едут в каждом сообщении: телефон хранит их копию.
    message.swipe = swipe;
    message.rotate = rotation;
    this.outbox = this.outbox.then(() => publish(target, "phone", message)).catch(() => undefined);
  }

  /**
   * Телефон прислал статью с местом чтения, каким он его знал. Если книга
   * с тех пор листала (например, страницу перезагрузили), на сервере лежит
   * более свежий прогресс — берём его.
   */
  freshAnchor(articleId: string, sentAnchor: number, sentVersion: string): Promise<number> {
    return next<PhoneMessage>(this.session, "phone", "0", false)
      .then((r) => {
        // Прогресс лежит либо сам по себе, либо внутри сообщения о ссылке или выходе.
        const p = r && (r.message.type === "progress" ? r.message : r.message.progress);
        return r && p && p.articleId === articleId && isNewer(r.version, sentVersion) ? p.anchor : sentAnchor;
      })
      .catch(() => sentAnchor);
  }

  /** Заводит новую сессию: прежний телефон больше не связан с книгой. */
  reset(): void {
    this.generation++;
    this.session = newSessionId();
    store.set(KEY, this.session);
    this.paired = false;
    store.remove(PAIRED_KEY);
    this.version = "0";
    this.listen();
  }
}
