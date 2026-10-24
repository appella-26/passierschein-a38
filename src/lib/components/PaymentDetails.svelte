<script lang="ts">
  import type { Payment } from '#lib/types.ts';
  import { t } from '#lib/i18n.ts';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';
  let { payment, oncopy }: { payment: Payment; oncopy: (value: string) => void } = $props();
  const fields = $derived([
    { label: t('paymentRecipient'), value: payment.recipient },
    { label: t('iban'), value: payment.iban },
    { label: t('paymentReference'), value: payment.purpose }
  ]);
</script>

<Card class="space-y-4">
  <h2 class="flex items-center gap-2 font-headline text-headline-md text-primary"><Icon name="bank" size={22} class="shrink-0" />{t('paymentDetails')}</h2>
  <dl class="space-y-3">
    {#each fields as field}
      <div class="flex items-start justify-between gap-3 rounded-xl bg-surface-container-low p-3">
        <div class="min-w-0 flex-1"><dt class="text-label-md text-on-surface-variant">{field.label}</dt><dd class="data-value mt-1 select-all font-mono text-body-sm text-primary">{field.value ?? t('paymentMissing')}</dd></div>
        {#if field.value}<button type="button" class="touch-icon shrink-0 text-secondary hover:bg-surface-container" aria-label={t('copyReference', { label: field.label })} onclick={() => oncopy(field.value!)}><Icon name="copy" size={18} /></button>{/if}
      </div>
    {/each}
  </dl>
  <p class="prose-copy text-[12px] leading-5 text-outline">{t('paymentCheck')}</p>
</Card>
