import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

// Установка на рабочий стол телефона: браузеру нужен service worker.
// Он доступен только по HTTPS (или на localhost). Адрес относительный:
// приложение живёт в папке phone/ сайта проекта.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => undefined);
}

mount(App, { target: document.getElementById("app")! });
