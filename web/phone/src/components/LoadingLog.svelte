<script lang="ts">
  // Лог загрузки: текущая строка стоит по центру экрана, предыдущие
  // приподнимаются над ней.
  import type { Text } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";

  interface Props {
    lines: Text[];
  }
  let { lines }: Props = $props();
</script>

{#if lines.length > 0}
  <div class="fixed inset-0 z-10 overflow-hidden bg-page">
    <!-- Опускаем на полстроки, чтобы по центру оказалась середина строки. -->
    <div class="absolute inset-x-0 bottom-1/2 -mb-[0.75em] px-5 text-center">
      {#each lines as line, i (i)}
        <div class="mt-[0.5em] text-ink-2 last:font-bold last:text-ink">{t(line.key, line.args)}</div>
      {/each}
    </div>
  </div>
{/if}
