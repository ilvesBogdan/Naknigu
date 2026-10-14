// Кодировка скачанной страницы. Сервер отдаёт страницу байт в байт, как её
// прислал сайт, а перекодирует её браузер — в нём для этого есть TextDecoder.

/**
 * Определяет кодировку: сначала по заголовку Content-Type, затем по тегу
 * <meta> в начале страницы. Если нигде не сказано — UTF-8.
 */
export function detectCharset(contentType: string | null, bytes: Uint8Array): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || "");
  if (fromHeader) {
    return fromHeader[1].toLowerCase();
  }
  // Тег <meta> состоит из символов ASCII, поэтому начало страницы можно
  // прочитать побайтно, ещё не зная её кодировки.
  let head = "";
  const limit = Math.min(bytes.length, 2048);
  for (let i = 0; i < limit; i++) {
    head += String.fromCharCode(bytes[i]);
  }
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return fromMeta ? fromMeta[1].toLowerCase() : "utf-8";
}

/** Переводит байты страницы в текст. Неизвестную кодировку читает как UTF-8. */
export function decodePage(contentType: string | null, bytes: Uint8Array): string {
  try {
    return new TextDecoder(detectCharset(contentType, bytes)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
