// Витрина проекта: страница с описанием, на которой код книги показан
// на нарисованной электронной книге, а рядом его сканирует нарисованный
// телефон. Сама витрина лежит отдельно (web/site) и подгружается только
// в современных браузерах.
//
// Браузер электронной книги — старый Chromium: в нём нет ни :has(), ни
// контейнерных запросов, ни цветов oklch(). Там эта проверка не проходит,
// и страница книги остаётся прежней до последнего пикселя: ничего лишнего
// не скачивается и не выполняется.

/** Умеет ли браузер то, на чём построена витрина. */
function modern(): boolean {
  try {
    return (
      CSS.supports("selector(:has(a))") &&
      CSS.supports("container-type", "inline-size") &&
      CSS.supports("color", "oklch(50% 0.1 50)")
    );
  } catch (e) {
    return false;
  }
}

/**
 * Подгружает витрину вместо экрана связывания. Пока она грузится, экран
 * книги скрыт, чтобы не мелькнул; не загрузилась за три секунды — остаётся
 * обычный экран с кодом.
 */
export function offerShowcase(): void {
  if (!modern()) {
    return;
  }
  const screen = document.getElementById("screen");
  if (!screen) {
    return;
  }
  screen.style.visibility = "hidden";
  const reveal = () => {
    clearTimeout(timer);
    screen.style.visibility = "";
  };
  const timer = setTimeout(reveal, 3000);
  // Витрина сообщает, что нарисована; с этого момента экран книги скрывает её CSS.
  window.addEventListener("naknigu:showcase", reveal);

  // Сначала стили, потом код: без стилей витрина была бы хуже прежнего экрана.
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "site/showcase.css";
  css.onerror = reveal;
  css.onload = () => {
    const js = document.createElement("script");
    js.type = "module";
    js.src = "site/showcase.js";
    js.onerror = reveal;
    document.head.appendChild(js);
  };
  document.head.appendChild(css);
}
