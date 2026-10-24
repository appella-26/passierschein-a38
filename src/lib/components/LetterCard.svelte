<script lang="ts">
  import type { DocumentDetail, DocumentRow } from '#lib/types.ts';
  import { deadlineLabel, formatDate, urgency } from '#lib/format.ts';
  import { t } from '#lib/i18n.ts';
  import Icon from './Icon.svelte';
  import Pill from './Pill.svelte';
  let { doc, detail, demo = false, compact = false, completed = false }: { doc: DocumentRow; detail?: DocumentDetail; demo?: boolean; compact?: boolean; completed?: boolean } = $props();
</script>

<a href={`/letters/${encodeURIComponent(doc.id)}${demo ? '?demo=1' : ''}`} class="block rounded-xl border border-surface-container bg-white p-4 shadow-paper transition-colors hover:bg-surface-container-low focus-visible:outline-secondary">
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0"><p class="text-[11px] uppercase tracking-wide text-outline">{doc.sender_name}</p></div>
    <div class="max-w-[46%] shrink-0"><Pill urgency={completed ? 'low' : urgency(doc.urgency)} label={completed ? t('done') : doc.deadline ? deadlineLabel(doc.deadline) : t('low')} /></div>
  </div>
  {#if compact}<h3 class="mt-2 font-headline text-headline-sm text-primary">{doc.document_type}</h3>{/if}
  {#if !compact}<h2 class="mt-3 font-headline text-headline-md text-primary">{doc.document_type}</h2><p class="mt-1 text-body-sm text-on-surface-variant">{t('received', { date: formatDate(doc.created_at) })}{#if doc.deadline}<span class="mx-1.5 text-outline">·</span><span class="text-error">{t('dueDate', { date: formatDate(doc.deadline) })}</span>{/if}</p>{/if}
  {#if doc.deadline || detail?.analysis.amount_due}
    <div class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-body-sm">
      {#if doc.deadline}<span class="inline-flex items-center gap-1.5 text-error"><Icon name="calendar" size={16} />{deadlineLabel(doc.deadline)}</span>{/if}
      {#if detail?.analysis.amount_due}<span class="font-headline text-[18px] font-semibold text-primary">{detail.analysis.amount_due}</span>{/if}
    </div>
  {/if}
  {#if !compact}<p class="mt-3 line-clamp-2 text-body-sm text-on-surface-variant">{doc.summary}</p>{#if detail?.analysis.keywords.length}<div class="mt-3 flex flex-wrap gap-1.5">{#each detail.analysis.keywords.slice(0, 3) as word}<span class="rounded-md bg-surface-container px-2 py-1 text-[10px] text-on-surface-variant">#{word}</span>{/each}</div>{/if}{/if}
</a>
