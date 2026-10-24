<script lang="ts">
  import type { ActionItem, DocumentDetail } from '#lib/types.ts';
  import { formatDate } from '#lib/format.ts';
  import { t } from '#lib/i18n.ts';
  import { setCompleted } from '#lib/checklist.svelte.ts';
  import Card from './Card.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  let { doc, completed, oncall }: { doc: DocumentDetail; completed: number[]; oncall: (action: ActionItem) => void } = $props();
</script>

<Card class="space-y-4">
  <div class="section-heading">
    <h2 class="flex items-center gap-2 font-headline text-headline-md text-primary"><Icon name="list" size={22} class="shrink-0" />{t('todos')}</h2>
    <span class="shrink-0 whitespace-nowrap rounded-full bg-secondary-container px-2.5 py-1 text-[11px] text-on-secondary-fixed-variant">{t('completed', { done: completed.length, total: doc.analysis.action_items.length })}</span>
  </div>
  <div class="space-y-3">
    {#each doc.analysis.action_items as action, index (index)}
      <div class="space-y-3 rounded-xl bg-surface-container-low p-3">
        <div class="flex items-start gap-2">
          <label class="-ml-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg">
            <input type="checkbox" class="size-6 rounded-md accent-secondary" checked={completed.includes(index)} onchange={event => setCompleted(doc.id, index, event.currentTarget.checked)} aria-label={t('completeAction', { title: action.title })} />
          </label>
          <h3 class="min-w-0 flex-1 pt-2.5 text-label-lg text-primary" class:line-through={completed.includes(index)} class:opacity-60={completed.includes(index)}>{action.title}</h3>
        </div>
        <p class="prose-copy whitespace-pre-line text-body-sm text-on-surface-variant">{action.details}</p>
        {#if action.due}<p class="text-[12px] text-outline">{t('deadlineLabel')}: <time datetime={action.due} class="whitespace-nowrap">{formatDate(action.due, true)}</time></p>{/if}
        {#if action.type === 'call'}
          <div class="space-y-3 rounded-lg border border-surface-container bg-white p-3">
            <div class="section-heading">
              <h4 class="flex items-center gap-1.5 text-label-md text-primary"><Icon name="headset" size={18} class="shrink-0 text-secondary" />{t('waitingPilot')}</h4>
              <span class="shrink-0 rounded-full bg-surface-container px-2 py-1 text-[10px] text-on-surface-variant">{t('automaticCall')}</span>
            </div>
            <p class="prose-copy text-body-sm text-on-surface-variant">{t('waitingHint')}</p>
            {#if action.phone}
              <p class="whitespace-nowrap font-mono text-body-sm text-primary">{action.phone_raw ?? action.phone}</p>
              <Button class="w-full" onclick={() => oncall(action)}><Icon name="headset" size={20} />{t('waitForMe')}</Button>
            {:else}<p class="text-body-sm text-outline">{t('missingPhone')}</p>{/if}
          </div>
        {/if}
      </div>
    {:else}<p class="text-body-sm text-on-surface-variant">{t('noActions')}</p>{/each}
  </div>
  <p class="text-[12px] leading-5 text-outline">{t('localChecklist')}</p>
</Card>
