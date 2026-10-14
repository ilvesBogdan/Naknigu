// Клиент API сервера: обмен сообщениями между телефоном и книгой
// и скачивание страниц чужих сайтов.
//
// Все обращения к серверу идут только через этот файл: адреса перечислены
// в ENDPOINTS, и contract.test.ts сверяет их с api/openapi.yaml.
import type { Args, BookMessage, Channel, PhoneMessage } from "./protocol";

/**
 * Адрес сервера API, например https://naknigu.203-0-113-10.sslip.io.
 * Подставляется при сборке из переменной окружения NAKNIGU_API_URL (на GitHub —
 * переменная репозитория); пустая строка — API на том же сайте, что и клиенты.
 */
declare const __API_URL__: string | undefined;
export const API_URL: string = typeof __API_URL__ === "string" ? __API_URL__ : "";

interface Endpoint {
  method: "GET" | "POST";
  path: string;
}

/** Все адреса сервера, к которым обращаются клиенты. */
export const ENDPOINTS: Record<string, Endpoint> = {
  fetch: { method: "GET", path: "/api/fetch" },
  publishBook: { method: "POST", path: "/api/sessions/{session}/book" },
  publishPhone: { method: "POST", path: "/api/sessions/{session}/phone" },
  nextBook: { method: "GET", path: "/api/sessions/{session}/book/next" },
  nextPhone: { method: "GET", path: "/api/sessions/{session}/phone/next" },
};

/** Ошибка с кодом из словаря `errors.*` — её текст переводит интерфейс. */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    readonly args: Args = {},
  ) {
    super(code);
  }
}

export interface Received<T> {
  version: string;
  message: T;
}

/** fetch с пределом времени: зависший запрос не должен останавливать обмен. */
export function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  // Object.assign, а не {...init}: под ES2015 сборщик добавляет к каждому
  // такому месту вспомогательный код, а коду книги положено быть маленьким.
  return fetch(url, Object.assign({ signal: abort.signal }, init))
    .catch(() => {
      throw new CodedError("network");
    })
    .finally(() => clearTimeout(timer));
}

/**
 * Запрос к серверу по описанию из ENDPOINTS. Ответ с ошибкой превращается
 * в CodedError с кодом, который прислал сервер ({"error": "timeout"}).
 */
function call(endpoint: Endpoint, session: string, query: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }
  const url = API_URL + endpoint.path.replace("{session}", session) + query;
  return request(url, Object.assign({ method: endpoint.method, headers }, init), timeoutMs).then((response) => {
    if (response.ok) {
      return response;
    }
    return response.json().then(
      (body: { error?: string; status?: number }) => {
        throw new CodedError(body.error || "network", { status: body.status || response.status });
      },
      () => {
        throw new CodedError("network", { status: response.status });
      },
    );
  });
}

/**
 * Отправляет сообщение в канал. listeners — сколько устройств ждали его
 * в этот момент (0 значит, что вторая сторона не на связи).
 */
export function publish(
  session: string,
  channel: Channel,
  message: BookMessage | PhoneMessage,
): Promise<{ version: string; listeners: number }> {
  const endpoint = channel === "book" ? ENDPOINTS.publishBook : ENDPOINTS.publishPhone;
  return call(endpoint, session, "", { body: JSON.stringify(message) }, 15000).then((response) => response.json());
}

/**
 * Возвращает сообщение новее версии after. С wait=true ждёт его появления
 * (long polling), иначе отвечает сразу. null — новых сообщений нет.
 */
export function next<T>(session: string, channel: Channel, after: string, wait: boolean): Promise<Received<T> | null> {
  const endpoint = channel === "book" ? ENDPOINTS.nextBook : ENDPOINTS.nextPhone;
  const query = "?after=" + after + (wait ? "" : "&wait=0");
  return call(endpoint, session, query, {}, wait ? 40000 : 10000).then((response) =>
    response.status === 204 ? null : (response.json() as Promise<Received<T>>),
  );
}

/**
 * Скачивает страницу чужого сайта через сервер. Ответ с ошибкой —
 * CodedError с кодом сервера; status в args — код ответа.
 */
export function fetchPage(url: string, timeoutMs: number): Promise<Response> {
  return call(ENDPOINTS.fetch, "", "?url=" + encodeURIComponent(url), {}, timeoutMs);
}

/**
 * Версии — наносекунды в виде строки: в число JavaScript они не помещаются,
 * поэтому сравниваем сначала по длине, потом посимвольно.
 */
export function isNewer(a: string, b: string): boolean {
  return a.length !== b.length ? a.length > b.length : a > b;
}

/** Новый идентификатор сессии: 128 случайных бит, 32 шестнадцатеричных знака. */
export function newSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < bytes.length; i++) {
    id += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  }
  return id;
}

export function isSessionId(value: string): boolean {
  return /^[a-z0-9]{32,64}$/.test(value);
}
