import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// Адрес сервера API (см. web/shared/api.ts); пусто — тот же сайт. Он
// попадает в код как есть, поэтому принимаем только адрес сайта.
const apiUrl = process.env.NAKNIGU_API_URL ?? "";
if (apiUrl && !/^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/.test(apiUrl)) {
  throw new Error("NAKNIGU_API_URL must look like https://host or https://host:port, without a path");
}

// Конфиг читает Vite, а не наш код.
// noinspection JSUnusedGlobalSymbols
export default defineConfig({
  // Адреса относительные: приложение лежит в папке phone/ сайта проекта,
  // а сам сайт на GitHub Pages — по адресу https://<имя>.github.io/<проект>/.
  base: "./",
  plugins: [tailwindcss(), svelte()],
  define: {
    __API_URL__: JSON.stringify(apiUrl),
  },
  server: {
    // При разработке запросы к API уходят на локально запущенный сервер Go.
    proxy: { "/api": "http://127.0.0.1:8081" },
  },
  test: {
    include: ["src/**/*.test.ts", "../shared/**/*.test.ts"],
  },
});
