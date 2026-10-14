// Лог загрузки: текущая строка стоит по центру экрана, предыдущие
// приподнимаются над ней. Без анимаций — e-ink их не любит.
import { byId } from "./dom";

export const loadingLog = {
  add(text: string): void {
    const line = document.createElement("div");
    line.textContent = text;
    byId("log").appendChild(line);
    byId("loading").className = "shown";
  },
  hide(): void {
    byId("loading").className = "";
    byId("log").textContent = "";
  },
};
