<script lang="ts">
  import { page } from '$app/state';
  import { language, setLanguage, t } from '#lib/i18n.ts';
  import Icon from './Icon.svelte';
  let { subtitle, backHref }: { subtitle?: string; backHref?: string } = $props();
  const demoSuffix = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1' ? '?demo=1' : '');
</script>

<header class="sticky top-0 z-30 border-b border-surface-container-low bg-surface pt-[env(safe-area-inset-top,0px)]">
  <div class="mx-auto flex min-h-20 max-w-[1100px] items-center justify-between gap-2 px-4 md:px-8">
    <div class="flex min-w-0 items-center gap-2.5">
      {#if backHref}<a href={backHref} class="touch-icon text-primary" aria-label={t('back')}><Icon name="back" /></a>{/if}
      <a href={'/' + demoSuffix} aria-label={t('brand')} class="flex shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary size-10 font-headline text-[28px]">A</a>
      <div class="min-w-0"><p class="font-headline text-[23px] leading-7 text-primary">{t('brand')}</p><p class="truncate text-[10px] tracking-wide text-outline sm:text-label-sm">{subtitle ?? t('brandTagline')}</p></div>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <div class="flex rounded-full bg-surface-container p-1" role="group" aria-label={t('language')}>
        {#each ['de', 'en'] as lang}
          <button type="button" class="min-h-11 min-w-11 rounded-full text-label-md {language.current === lang ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}" aria-label={t(lang === 'de' ? 'german' : 'english')} aria-pressed={language.current === lang} onclick={() => setLanguage(lang === 'de' ? 'de' : 'en')}>{lang.toUpperCase()}</button>
        {/each}
      </div>
      <span class="hidden size-10 items-center justify-center rounded-full bg-primary text-white min-[380px]:inline-flex"><Icon name="user" /></span>
    </div>
  </div>
</header>
