/** Разметка витрины: esbuild подставляет файл .html строкой (--loader:.html=text). */
declare module "*.html" {
  const html: string;
  export default html;
}
