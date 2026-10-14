// QR-код — отдельный файл qr.js. Он занимает половину всего кода книги,
// а нужен только на экране связывания: связанная с телефоном книга его
// не скачивает и не разбирает вовсе. Загружает его src/qrloader.ts.
import qrcode from "qrcode-generator";
import type { QrSvg } from "./qrloader";

const svg: QrSvg = (text) => {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ scalable: true, margin: 2 });
};

(window as unknown as { nakniguQrSvg: QrSvg }).nakniguQrSvg = svg;
