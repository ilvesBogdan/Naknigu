<script lang="ts">
  import AddForm from "./components/AddForm.svelte";
  import ArticleList from "./components/ArticleList.svelte";
  import LoadingLog from "./components/LoadingLog.svelte";
  import Notifications from "./components/Notifications.svelte";
  import { PhoneApp } from "./lib/app.svelte";
  import { currentLang, t, tError } from "./lib/i18n.svelte";

  const app = new PhoneApp();
  app.start();

  document.documentElement.lang = currentLang();
  document.title = t("title");

  // Страница книги лежит на уровень выше страницы телефона (…/phone/).
  const bookUrl = location.href.replace(/[?#].*$/, "").replace(/phone\/[^/]*$/, "");
</script>

<main class="mx-auto max-w-xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
  <h1 class="mb-5 text-[1.65rem] leading-tight font-bold tracking-tight">{t("title")}</h1>

  <p class="mb-4 flex items-start gap-3 rounded-2xl bg-card px-4 py-3 text-[0.9rem] text-ink-2 shadow-sm ring-1 ring-line [overflow-wrap:anywhere]">
    <span
      class={["mt-[0.45em] size-2.5 flex-none rounded-full", app.paired ? "bg-ok shadow-[0_0_0_4px] shadow-ok/20" : "bg-ink-2/40"]}
      aria-hidden="true"
    ></span>
    <span>{t(app.paired ? "link.paired" : "link.unpaired", { url: bookUrl })}</span>
  </p>

  {#if app.failure}
    <p class="mb-4 rounded-2xl bg-danger/10 px-4 py-3 font-semibold text-danger">
      {t("notice.error", { text: tError(app.failure.code, app.failure.args) })}
    </p>
  {:else if app.notice}
    <p class="mb-4 rounded-2xl bg-accent/10 px-4 py-3 font-semibold text-accent-2">{t(app.notice.key, app.notice.args)}</p>
  {/if}

  {#if app.link}
    <p class="mb-4 rounded-2xl border-2 border-dashed border-accent/50 bg-card px-4 py-3 break-all">
      {t("link.request")}
      <a
        class="font-semibold text-accent-2 underline decoration-accent/40 underline-offset-4"
        href={app.link}
        target="_blank"
        rel="noopener noreferrer"
        onclick={() => (app.link = "")}>{app.link}</a
      >
    </p>
  {/if}

  <AddForm onadd={(url) => app.add(url)} />
  <ArticleList articles={app.articles} onopen={(id) => app.open(id)} onremove={(id) => app.remove(id)} />
  <Notifications />
</main>

<LoadingLog lines={app.log} />
