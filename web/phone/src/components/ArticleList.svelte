<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { Saved } from "../lib/library";

  interface Props {
    articles: Saved[];
    onopen: (id: string) => void;
    onremove: (id: string) => void;
  }
  let { articles, onopen, onremove }: Props = $props();

  function info(item: Saved): string {
    const parts = [item.byline];
    if (item.readingTime) {
      parts.push(t("list.minutes", { n: item.readingTime }));
    }
    parts.push(item.percent > 0 ? t("list.read", { n: item.percent }) : t("list.not_started"));
    return parts.filter(Boolean).join(" · ");
  }
</script>

<div class="space-y-3">
  {#each articles as item (item.id)}
    <div class="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line">
      <button
        type="button"
        class="block w-full cursor-pointer rounded-md text-left text-[1.05rem] leading-snug font-semibold"
        onclick={() => onopen(item.id)}>{item.title}</button
      >
      <span class="mt-1.5 block text-sm text-ink-2">{info(item)}</span>
      <div class="mt-3 flex items-center gap-3">
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <span class="block h-full rounded-full bg-accent" style:width="{item.percent}%"></span>
        </span>
        <button
          type="button"
          class="flex-none cursor-pointer rounded-full px-3 py-1 text-sm text-ink-2 ring-1 ring-line transition active:bg-danger/10 active:text-danger"
          onclick={() => onremove(item.id)}>{t("list.remove")}</button
        >
      </div>
    </div>
  {:else}
    <p class="rounded-2xl border-2 border-dashed border-line px-4 py-8 text-center text-ink-2">{t("list.empty")}</p>
  {/each}
</div>
