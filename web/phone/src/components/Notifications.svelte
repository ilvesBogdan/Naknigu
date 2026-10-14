<script lang="ts">
  // Кнопка «Разрешить уведомления». Уведомления браузер даёт только
  // на HTTPS; где их нет или вопрос уже решён, блок не показывается.
  import { t } from "../lib/i18n.svelte";

  let canAsk = $state("Notification" in window && window.isSecureContext && Notification.permission === "default");

  async function allow() {
    await Notification.requestPermission();
    canAsk = Notification.permission === "default";
  }
</script>

{#if canAsk}
  <section class="mt-6 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line">
    <p class="mb-3 text-ink-2">{t("settings.notify")}</p>
    <button
      type="button"
      class="h-11 w-full cursor-pointer rounded-xl bg-ink font-semibold text-page transition active:scale-[0.98]"
      onclick={allow}>{t("settings.notify.allow")}</button
    >
  </section>
{/if}
