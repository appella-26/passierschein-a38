<script lang="ts">
  import '../app.css';
  import { onMount, untrack, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import { initLanguage, language, t } from '#lib/i18n.ts';
  import AppHeader from '#lib/components/AppHeader.svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { resetDemoChecklist } from '#lib/checklist.svelte.ts';
  import { callSession, restoreCallContext, selectCallMode, stopCallEvents, watchCall } from '#lib/call-session.svelte.ts';
  let { children }: { children: Snippet } = $props();
  const isLetter = $derived(page.url.pathname.startsWith('/letters/'));
  const isCall = $derived(page.url.pathname.startsWith('/calls/'));
  const demo = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1');
  const monitoredCallId = $derived(isCall ? page.params.id : callSession.context && !!callSession.context.demo === demo ? callSession.context.id : undefined);
  onMount(() => { initLanguage(); restoreCallContext(demo); });
  $effect(() => {
    const preview = demo;
    untrack(() => { selectCallMode(preview); if (!preview) resetDemoChecklist(); });
  });
  $effect(() => {
    const id = monitoredCallId;
    const preview = demo;
    if (!id) return;
    untrack(() => watchCall(id, preview));
    return stopCallEvents;
  });
</script>

<svelte:head><title>{t('brand')} · {t('brandTagline')}</title><meta name="description" content={t('homeIntro')} /></svelte:head>
<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-primary focus:p-4 focus:text-white">{t('skip')}</a>
<div lang={language.current}>
  <AppHeader subtitle={isLetter ? t('result') : isCall ? t('liveCall') : undefined} backHref={isLetter ? '/archive' + (demo ? '?demo=1' : '') : isCall ? '/' + (demo ? '?demo=1' : '') : undefined} />
  {#if demo}<div class="border-b border-secondary-container bg-secondary-container/40 px-4 py-2 text-center text-label-md text-on-secondary-fixed-variant">{t('preview')}</div>{/if}
  <main id="main" class="page-column" class:with-nav={!isLetter && !isCall} class:with-action={page.url.pathname === '/archive'} tabindex="-1">{#key demo}{@render children()}{/key}</main>
  {#if !isLetter && !isCall}<BottomNav />{/if}
</div>
