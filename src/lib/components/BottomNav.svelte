<script lang="ts">
  import { page } from '$app/state';
  import { t } from '#lib/i18n.ts';
  import Icon, { type IconName } from './Icon.svelte';
  const tabs = [{ href: '/', key: 'scan', icon: 'scan' }, { href: '/archive', key: 'archive', icon: 'folder' }, { href: '/graph', key: 'graph', icon: 'graph' }] as const;
  const suffix = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1' ? '?demo=1' : '');
</script>

<nav aria-label={t('brandTagline')} class="fixed inset-x-0 bottom-0 z-20 border-t border-surface-container bg-surface pb-[var(--nav-safe-padding)] shadow-paper">
  <div class="shell-container flex h-[var(--nav-content-height)] items-center justify-around">
    {#each tabs as tab}
      <a href={tab.href + suffix} aria-current={page.url.pathname === tab.href ? 'page' : undefined} class="flex min-h-12 min-w-20 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl text-[11px] {page.url.pathname === tab.href ? 'font-semibold text-primary' : 'text-on-surface-variant hover:text-primary'}"><Icon name={tab.icon as IconName} size={24} />{t(tab.key)}</a>
    {/each}
  </div>
</nav>
