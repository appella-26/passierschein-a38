<script lang="ts">
  import { onDestroy } from 'svelte';
  import { page } from '$app/state';
  import type { ActionItem, DocumentDetail } from '#lib/types.ts';
  import { ApiError, getDocument } from '#lib/api.ts';
  import { deadlineLabel, formatDate } from '#lib/format.ts';
  import { language, t } from '#lib/i18n.ts';
  import { completedActions } from '#lib/checklist.svelte.ts';
  import Card from '#lib/components/Card.svelte';
  import Button from '#lib/components/Button.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Pill from '#lib/components/Pill.svelte';
  import CallConfirm from '#lib/components/CallConfirm.svelte';
  import BottomSheet from '#lib/components/BottomSheet.svelte';
  import ActionChecklist from '#lib/components/ActionChecklist.svelte';
  import ReferenceChip from '#lib/components/ReferenceChip.svelte';
  import PaymentDetails from '#lib/components/PaymentDetails.svelte';
  import DeleteCase from '#lib/components/DeleteCase.svelte';
  import { clearCompletedUpload } from '#lib/upload-draft.ts';

  let doc = $state<DocumentDetail | null>(null);
  let loading = $state(true);
  let errorKey = $state<'notFound' | 'error' | null>(null);
  let reload = $state(0);
  let callAction = $state<ActionItem | null>(null);
  let confirmOpen = $state(false);
  let scanOpen = $state(false);
  let scanPage = $state(1);
  let scanError = $state(false);
  let toast = $state<'copied' | 'copyFailed' | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let today = $state(new Date());
  const demo = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1');
  const completed = $derived(doc ? completedActions(doc, demo) : []);

  $effect(() => {
    const id = page.params.id;
    const isDemo = demo;
    const lang = isDemo ? language.current : 'en';
    void reload;
    if (!id) return;
    const abort = new AbortController();
    loading = true; errorKey = null; doc = null; scanOpen = false; confirmOpen = false; callAction = null; toast = null;
    clearTimeout(toastTimer);
    (async () => {
      try {
        if (isDemo) {
          const sample = (await import('#lib/mock/data.ts')).getMockDocuments(lang).find(item => item.id === id);
          if (!sample) throw new ApiError(404);
          if (!abort.signal.aborted) doc = sample;
        } else {
          const result = await getDocument(id, abort.signal);
          if (!abort.signal.aborted) { doc = result; clearCompletedUpload(id); }
        }
      } catch (error) { if (!abort.signal.aborted) errorKey = error instanceof ApiError && error.status === 404 ? 'notFound' : 'error'; }
      finally { if (!abort.signal.aborted) loading = false; }
    })();
    const timer = setInterval(() => today = new Date(), 60000);
    return () => { abort.abort(); clearInterval(timer); };
  });
  $effect(() => { void scanPage; scanError = false; });

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast = 'copied'; }
    catch { toast = 'copyFailed'; }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast = null, 3000);
  }
  function prepareCall(action: ActionItem) { callAction = action; confirmOpen = true; }
  onDestroy(() => clearTimeout(toastTimer));
</script>

<svelte:head><title>{doc?.document_type ?? t('result')} · {t('brand')}</title></svelte:head>
{#if loading}<Card><p role="status" class="text-body-md text-outline">{t('loading')}</p></Card>
{:else if errorKey}<Card class="space-y-4"><h1 class="font-headline text-headline-lg-mobile text-primary">{t(errorKey)}</h1><Button onclick={() => reload++}>{t('retry')}</Button></Card>
{:else if doc}
  <div class="space-y-6">
    <Card class="space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-1 items-start gap-2.5">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-container text-primary"><Icon name="bank" size={24} /></span>
          <div class="min-w-0"><p class="eyebrow text-outline">{t('sender')}</p><p class="text-label-lg text-primary">{doc.analysis.sender.name}</p></div>
        </div>
        <div class="max-w-[42%] shrink-0"><Pill urgency={doc.analysis.urgency} label={doc.analysis.urgency === 'high' ? t('urgent') : undefined} /></div>
      </div>
      <h1 class="font-headline text-headline-lg-mobile text-primary md:text-headline-lg">{doc.analysis.document_type}</h1>
      {#if doc.analysis.letter_date}<p class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body-sm text-on-surface-variant"><Icon name="calendar" size={16} class="shrink-0" /><span>{t('letterDate')}</span><time datetime={doc.analysis.letter_date} class="whitespace-nowrap">{formatDate(doc.analysis.letter_date, true)}</time></p>{/if}
    </Card>
    {#if doc.analysis.deadline || doc.analysis.amount_due}
      <Card class="relative overflow-hidden !pl-5">
        <div class="absolute inset-y-0 left-0 w-1 {doc.analysis.urgency === 'high' ? 'bg-error' : 'bg-on-tertiary-container'}"></div>
        <div class="space-y-4">
          <h2 class="eyebrow flex items-center gap-1.5 {doc.analysis.urgency === 'high' ? 'text-error' : 'text-on-tertiary-fixed-variant'}"><Icon name="clock" size={16} />{t(doc.analysis.deadline ? 'deadline' : 'amount')}</h2>
          <div class="grid items-center gap-4 {doc.analysis.amount_due && doc.analysis.deadline ? 'sm:grid-cols-2' : ''}">
            {#if doc.analysis.amount_due}
              <div>
                <p class="whitespace-nowrap font-headline text-headline-xl-mobile font-semibold {doc.analysis.urgency === 'high' ? 'text-error' : 'text-on-tertiary-fixed-variant'}">{doc.analysis.amount_due}</p>
                <p class="mt-1 text-body-sm text-on-surface-variant">{t('amount')}</p>
              </div>
            {/if}
            {#if doc.analysis.deadline}
              <div class="flex items-start gap-2 text-primary">
                <Icon name="calendar" size={19} class="mt-0.5 shrink-0" />
                <div><p class="text-label-lg">{deadlineLabel(doc.analysis.deadline, today)}</p><time datetime={doc.analysis.deadline} class="mt-1 block whitespace-nowrap text-body-sm text-on-surface-variant">{formatDate(doc.analysis.deadline)}</time></div>
              </div>
            {/if}
          </div>
          {#if doc.analysis.deadline_is_estimate}<p class="prose-copy border-t border-surface-container pt-3 text-body-sm text-outline">{t('estimated')}</p>{/if}
        </div>
      </Card>
    {/if}
    <section class="space-y-3 rounded-xl bg-surface-container p-4">
      <h2 class="flex items-center gap-2 text-label-lg text-secondary"><Icon name="bulb" size={22} class="shrink-0" />{t('summary')}</h2>
      <p class="prose-copy text-body-md text-on-surface">{doc.analysis.summary}</p>
      <p class="flex items-start gap-2 text-[12px] leading-5 text-on-surface-variant"><Icon name="info" size={15} class="mt-0.5 shrink-0 text-secondary" /><span>{t('summaryDisclaimer')}</span></p>
    </section>
    {#if doc.analysis.references.length}
      <section class="space-y-3"><h2 class="eyebrow text-outline">{t('references')}</h2><div class="flex flex-wrap gap-2">{#each doc.analysis.references as reference, index (index)}<ReferenceChip label={reference.label} value={reference.value} oncopy={copy} />{/each}</div></section>
    {/if}
    {#if doc.analysis.payment}<PaymentDetails payment={doc.analysis.payment} oncopy={copy} />{/if}
    {#key doc.id}<ActionChecklist {doc} {completed} {demo} oncall={prepareCall} onupdate={updated => doc = updated} />{/key}
    <Card class="space-y-3"><h2 class="eyebrow text-outline">{t('related')}</h2>{#each doc.related as related (related.id)}<a href={`/letters/${encodeURIComponent(related.id)}${demo ? '?demo=1' : ''}`} class="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3 text-primary"><Icon name="document" size={22} class="shrink-0" /><div class="min-w-0 flex-1"><p class="text-label-md">{related.document_type}</p><p class="mt-1 text-body-sm text-on-surface-variant">{related.shared}</p></div><Icon name="arrow" size={20} class="shrink-0" /></a>{:else}<p class="text-body-sm text-outline">{t('noRelated')}</p>{/each}</Card>
    <div class="space-y-3">
      <div class="grid gap-3 sm:grid-cols-2"><Button variant="secondary" onclick={() => { scanPage = 1; scanOpen = true; }}><Icon name="scan" />{t('original')}</Button><a href={'/archive' + (demo ? '?demo=1' : '')} class="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-surface-container px-4 text-label-lg text-on-surface-variant"><Icon name="folder" />{t('backToArchive')}</a></div>
      <a href={`/assistant?letter=${encodeURIComponent(doc.id)}${demo ? '&demo=1' : ''}`} class="flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-label-md text-secondary hover:bg-surface-container-low"><Icon name="chat" size={18} />{t('chatAskLetter')}</a>
      <p class="text-center text-[12px] leading-5 text-outline">{t('alreadyArchived')}</p>
      <p class="mx-auto max-w-prose text-center text-[12px] leading-5 text-outline">{t('analysisLanguage')}</p>
      {#if !demo && doc.case_id}{#key doc.case_id}<DeleteCase caseId={doc.case_id} />{/key}{/if}
    </div>
  </div>
  {#if callAction}<CallConfirm bind:open={confirmOpen} {doc} action={callAction} {demo} />{/if}
  <BottomSheet bind:open={scanOpen} title={t('original')}>
    <div class="space-y-4"><p class="text-label-md text-primary">{t('page', { number: scanPage })} / {doc.page_count}</p>
      {#if demo}<div class="aspect-[3/4] rounded-xl border border-surface-container bg-white p-6 font-headline text-primary"><p class="text-headline-sm">{doc.sender_name}</p><h3 class="mt-8 text-headline-md">{doc.document_type}</h3><p class="mt-5 text-body-sm">{doc.analysis.summary}</p><p class="mt-4 font-mono text-body-sm">{doc.analysis.references.map(item => `${item.label}: ${item.value}`).join(' · ')}</p><p class="mt-8 text-body-sm text-outline">{t('preview')}</p></div>{:else}{#key scanPage}{#if scanError}<p role="alert" class="text-body-sm text-error">{t('originalError')}</p>{:else}<img src={`/api/documents/${encodeURIComponent(doc.id)}/pages/${scanPage}`} alt={t('originalPage', { number: scanPage })} class="w-full rounded-xl bg-white object-contain" onerror={() => scanError = true} />{/if}{/key}{/if}
      <div class="flex flex-wrap gap-2">{#each Array.from({ length: doc.page_count }, (_, index) => index + 1) as number}<button type="button" class="min-h-11 min-w-11 rounded-lg px-3 text-label-md {scanPage === number ? 'bg-primary text-white' : 'bg-surface-container text-primary'}" onclick={() => scanPage = number} aria-label={t('page', { number })} aria-pressed={scanPage === number}>{number}</button>{/each}</div>
    </div>
  </BottomSheet>
{/if}
{#if toast}<div role="status" class="fixed bottom-6 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-xl bg-inverse-surface px-4 py-3 text-body-sm text-inverse-on-surface shadow-paper"><Icon name={toast === 'copied' ? 'check' : 'warning'} size={18} class="shrink-0" />{t(toast)}</div>{/if}
