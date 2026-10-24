<script lang="ts">
  import { t } from '#lib/i18n.ts';
  let { urgency, label }: { urgency: 'high' | 'medium' | 'low'; label?: string } = $props();
  const colors = { high: 'bg-error-container text-on-error-container', medium: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', low: 'bg-secondary-container text-on-secondary-fixed-variant' };
</script>

<span class="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-label-sm {colors[urgency]}"><span class="h-1.5 w-1.5 shrink-0 rounded-full bg-current"></span>{label ?? t(urgency)}</span>
