<script lang="ts">
  import { t } from "../lib/i18n.svelte";

  interface Props {
    /** Добавляет статью; true — добавлена, поле можно очистить. */
    onadd: (url: string) => Promise<boolean>;
  }
  let { onadd }: Props = $props();

  let url = $state("");

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (await onadd(url)) {
      url = "";
    }
  }
</script>

<form class="mb-6 flex gap-2" onsubmit={submit}>
  <input
    class="h-12 min-w-0 flex-1 rounded-xl bg-card px-4 shadow-sm ring-1 ring-line placeholder:text-ink-2/70"
    type="text"
    inputmode="url"
    autocomplete="off"
    placeholder={t("add.placeholder")}
    bind:value={url}
  />
  <button
    class="h-12 flex-none cursor-pointer rounded-xl bg-accent px-5 font-semibold text-on-accent shadow-sm transition active:scale-[0.97] active:bg-accent-2"
    type="submit">{t("add.button")}</button
  >
</form>
