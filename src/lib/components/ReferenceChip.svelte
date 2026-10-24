<script lang="ts">
  import { t } from '#lib/i18n.ts';
  import Icon from './Icon.svelte';
  let { label, value, oncopy }: { label: string; value: string; oncopy: (value: string) => void } = $props();
</script>

<button type="button" onclick={() => oncopy(value)} aria-label={t('copyReference', { label })} class="flex min-h-12 max-w-full items-center gap-3 rounded-xl border border-surface-container bg-white px-3 py-2.5 text-left shadow-paper hover:bg-surface-container-low">
  <Icon name="tag" size={17} class="shrink-0 text-outline" />
  <span class="min-w-0">
    <span class="block text-label-md text-on-surface-variant">{label}</span>
    <span class="data-value mt-1 block select-all font-mono text-body-sm font-medium text-primary">{value}</span>
  </span>
  <Icon name="copy" size={16} class="shrink-0 text-outline" />
</button>
