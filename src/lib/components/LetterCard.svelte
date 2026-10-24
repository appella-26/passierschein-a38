<script lang="ts">
  import type { DocumentDetail, DocumentRow } from '#lib/types.ts';
  import { deadlineLabel, formatDate, urgency } from '#lib/format.ts';
  import { t } from '#lib/i18n.ts';
  import Icon from './Icon.svelte';
  import Pill from './Pill.svelte';
  let { doc, detail, demo = false, compact = false, completed = false }: { doc: DocumentRow; detail?: DocumentDetail; demo?: boolean; compact?: boolean; completed?: boolean } = $props();
</script>

<a href={`/letters/${encodeURIComponent(doc.id)}${demo ? '?demo=1' : ''}`} class="letter-card block rounded-xl border border-surface-container bg-white p-4 shadow-paper transition-colors hover:bg-surface-container-low focus-visible:outline-secondary">
  <div class="flex items-start justify-between gap-3">
    <p class="min-w-0 flex-1 text-[11px] leading-4 uppercase tracking-wide text-outline">{doc.sender_name}</p>
    <div class="max-w-[46%] shrink-0">
      <Pill urgency={completed ? 'low' : urgency(doc.urgency)} label={completed ? t('done') : doc.deadline ? deadlineLabel(doc.deadline) : t('low')} />
    </div>
  </div>
  {#if compact}
    <h3 class="mt-2 font-headline text-headline-sm text-primary">{doc.document_type}</h3>
  {:else}
    <h2 class="mt-3 font-headline text-headline-md text-primary">{doc.document_type}</h2>
    <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-on-surface-variant">
      <span class="whitespace-nowrap">{t('receivedLabel')}: <time datetime={doc.created_at}>{formatDate(doc.created_at, true)}</time></span>
      {#if doc.deadline}<span class="whitespace-nowrap {completed ? 'text-on-surface-variant' : 'text-error'}">{t('deadlineLabel')}: <time datetime={doc.deadline}>{formatDate(doc.deadline, true)}</time></span>{/if}
    </div>
  {/if}
  {#if (compact && doc.deadline && !completed) || detail?.analysis.amount_due}
    <div class="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-surface-container-low px-3 py-2 text-body-sm">
      {#if compact && doc.deadline && !completed}
        <span class="inline-flex items-center gap-1.5 whitespace-nowrap text-error"><Icon name="calendar" size={16} />{deadlineLabel(doc.deadline)}</span>
      {:else}<span class="text-on-surface-variant">{t('amount')}</span>{/if}
      {#if detail?.analysis.amount_due}<span class="whitespace-nowrap font-headline text-[18px] font-semibold text-primary">{detail.analysis.amount_due}</span>{/if}
    </div>
  {/if}
  {#if !compact}
    <p class="prose-copy mt-3 line-clamp-2 text-body-sm text-on-surface-variant">{doc.summary}</p>
    {#if detail?.analysis.keywords.length}
      <div class="mt-3 flex flex-wrap gap-1.5">
        {#each detail.analysis.keywords.slice(0, 3) as word}<span class="data-value max-w-full rounded-md bg-surface-container px-2 py-1 text-[10px] text-on-surface-variant">#{word}</span>{/each}
      </div>
    {/if}
  {/if}
</a>
