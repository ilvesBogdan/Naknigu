// Подгрузка qr.js по требованию — см. src/qr.ts.

/** Рисует QR-код с текстом text и возвращает его как разметку SVG. */
export type QrSvg = (text: string) => string;

let loading: Promise<QrSvg> | null = null;

/** Загружает qr.js один раз; повторные вызовы получают тот же результат. */
export function loadQr(): Promise<QrSvg> {
  if (!loading) {
    loading = new Promise<QrSvg>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "qr.js?v=" + BUILD;
      script.onload = () => resolve((window as unknown as { nakniguQrSvg: QrSvg }).nakniguQrSvg);
      script.onerror = () => {
        loading = null; // сеть пропала — следующий показ кода попробует снова
        reject(new Error("qr.js did not load"));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}
