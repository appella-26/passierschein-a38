<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { t, language, type TranslationKey } from '#lib/i18n.ts';
  import { ApiError, getDocument, request, post } from '#lib/api.ts';
  import { fileToBase64Jpeg } from '#lib/resize.ts';
  import type { AnalyzeResponse, DocumentDetail, DocumentRow } from '#lib/types.ts';
  import Button from '#lib/components/Button.svelte';
  import Card from '#lib/components/Card.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import LetterCard from '#lib/components/LetterCard.svelte';
  import Analyzing from '#lib/components/Analyzing.svelte';
  import { callSession, terminalStates } from '#lib/call-session.svelte.ts';
  import { clearUploadDraft, readUploadDraft, writeUploadDraft, type UploadDraft } from '#lib/upload-draft.ts';

  type CapturedPage = { id: number; file: File; url: string; encoded?: Promise<string> };
  let captures = $state<CapturedPage[]>([]);
  let cameraInput = $state<HTMLInputElement>(null!);
  let fileInput = $state<HTMLInputElement>(null!);
  let sequence = 0;
  let pending = $state(false);
  let preparing = $state(false);
  let previewScanning = $state(false);
  let uploadError = $state<TranslationKey | null>(null);
  let retryAfter = $state<number | null>(null);
  let retryUntil = $state(0);
  let retryNow = $state(Date.now());
  let requestId = $state<string | null>(null);
  let savedResultId = $state<string | null>(null);
  let recoveryBusy = $state(false);
  let recoveryUnavailable = $state(false);
  let draftRevision = 0;
  let disposed = false;
  let documents = $state<DocumentRow[]>([]);
  let recentDetails = $state<Record<string, DocumentDetail>>({});
  let listError = $state(false);
  let listLoading = $state(true);
  let reload = $state(0);
  let controller: AbortController | undefined;
  const demo = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1');
  const activeCall = $derived(callSession.context && !!callSession.context.demo === demo && callSession.connection !== 'unavailable' && !terminalStates.includes(callSession.state) ? callSession.context : null);
  const retryRemaining = $derived(Math.max(0, Math.ceil((retryUntil - retryNow) / 1000)));
  const focusedUpload = $derived(captures.length > 0 || savedResultId !== null);
  const errorSummary = $derived(uploadError ? ({
    imageOnly: 'uploadImageOnlyShort', resizeError: 'uploadResizeShort', analysisError: 'uploadFailedShort',
    analysisConfiguration: 'uploadConfigurationShort', analysisRateLimit: 'uploadRateLimitShort',
    analysisInvalidResponse: 'uploadInvalidResponseShort', analysisUnavailable: 'uploadUnavailableShort',
    analysisNetwork: 'uploadInterruptedShort', analysisInterrupted: 'uploadInterruptedShort',
    analysisTimeout: 'uploadTimeoutShort', analysisStorage: 'uploadStorageShort',
    analysisInvalidInput: 'uploadResizeShort', analysisNavigation: 'uploadSavedShort'
  } as Partial<Record<TranslationKey, TranslationKey>>)[uploadError] ?? uploadError : null);

  function restoreDraft() {
    if (demo) return;
    const draft = readUploadDraft();
    if (!draft) return;
    try {
      captures = draft.pages.map(item => {
        const bytes = Uint8Array.from(atob(item.data), char => char.charCodeAt(0));
        const file = new File([bytes], item.name, { type: 'image/jpeg' });
        return { id: ++sequence, file, url: URL.createObjectURL(file), encoded: Promise.resolve(item.data) };
      });
      requestId = draft.requestId ?? null;
      retryUntil = draft.retryUntil ?? 0; retryNow = Date.now();
      savedResultId = draft.phase === 'result' ? draft.resultId ?? null : null;
      uploadError = draft.phase === 'sending' ? 'analysisInterrupted' : savedResultId ? 'analysisNavigation' : draft.error ?? null;
      if (!captures.length) recoveryUnavailable = true;
    } catch { clearUploadDraft(); recoveryUnavailable = true; }
  }
  onMount(() => {
    if (demo) return;
    restoreDraft();
    // Stop the dying page's fetch handler from overwriting the in-flight recovery checkpoint.
    const unloading = () => { disposed = true; draftRevision++; controller?.abort(); };
    window.addEventListener('beforeunload', unloading);
    return () => window.removeEventListener('beforeunload', unloading);
  });
  $effect(() => {
    if (!retryUntil) return;
    const timer = setInterval(() => retryNow = Date.now(), 1000);
    return () => clearInterval(timer);
  });

  function encodedPage(item: CapturedPage) {
    return item.encoded ??= fileToBase64Jpeg(item.file);
  }
  async function persistDraft(phase: UploadDraft['phase']) {
    if (demo || disposed) return;
    const revision = ++draftRevision;
    const selected = [...captures];
    if (!selected.length && !savedResultId) { clearUploadDraft(); return; }
    recoveryBusy = true;
    try {
      const pages = [];
      for (const item of selected) pages.push({ name: item.file.name, data: await encodedPage(item) });
      if (disposed || revision !== draftRevision) return;
      recoveryUnavailable = !writeUploadDraft({ version: 1, phase, pages, error: uploadError, retryUntil, requestId, resultId: savedResultId });
    } catch { if (!disposed && revision === draftRevision) { clearUploadDraft(); recoveryUnavailable = true; } }
    finally { if (!disposed && revision === draftRevision) recoveryBusy = false; }
  }

  $effect(() => {
    const isDemo = demo;
    const lang = isDemo ? language.current : 'en';
    void reload;
    const abort = new AbortController();
    listLoading = true;
    listError = false; documents = []; recentDetails = {};
    (async () => {
      try {
        const mock = isDemo ? await import('#lib/mock/data.ts') : null;
        const rows = mock ? mock.mockRows('', lang) : await request<DocumentRow[]>('/api/documents', { signal: abort.signal });
        if (abort.signal.aborted) return;
        documents = rows;
        listLoading = false;
        await Promise.all(rows.slice(0, 3).map(async row => {
          try {
            const detail = mock ? mock.getMockDocuments(lang).find(doc => doc.id === row.id) : await getDocument(row.id, abort.signal);
            if (detail && !abort.signal.aborted) recentDetails[row.id] = detail;
          } catch { /* Basic recent cards are still useful without extra metadata. */ }
        }));
      }
      catch { if (!abort.signal.aborted) listError = true; }
      finally { if (!abort.signal.aborted) listLoading = false; }
    })();
    return () => abort.abort();
  });

  function addFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (savedResultId) discardPages();
    uploadError = null;
    retryAfter = null; retryUntil = 0; requestId = null; savedResultId = null;
    for (const file of Array.from(input.files ?? [])) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { uploadError = 'imageOnly'; continue; }
      captures.push({ id: ++sequence, file, url: URL.createObjectURL(file) });
    }
    input.value = '';
    void persistDraft('ready');
  }
  function removePage(id: number) {
    const captured = captures.find(item => item.id === id);
    if (captured) URL.revokeObjectURL(captured.url);
    captures = captures.filter(item => item.id !== id);
    void persistDraft('ready');
  }
  function cancelAnalysis() {
    controller?.abort();
    if (pending && !demo) { uploadError = 'analysisInterrupted'; void persistDraft('error'); }
    pending = false; preparing = false; previewScanning = false;
  }
  function discardPages() {
    controller?.abort(); draftRevision++;
    captures.forEach(item => URL.revokeObjectURL(item.url)); captures = [];
    savedResultId = null; uploadError = null; requestId = null;
    retryAfter = null; retryUntil = 0; recoveryUnavailable = false; recoveryBusy = false;
    if (!demo) clearUploadDraft();
  }
  async function analyze() {
    if (!captures.length || pending || recoveryBusy || savedResultId || retryRemaining) return;
    if (demo) { await goto('/letters/demo-tax?demo=1'); return; }
    const abort = new AbortController();
    controller = abort;
    uploadError = null;
    retryAfter = null;
    retryUntil = 0; requestId = null;
    pending = true;
    preparing = true;
    const lang = language.current;
    try {
      const images: string[] = [];
      for (const captured of captures) {
        if (abort.signal.aborted) return;
        images.push(await encodedPage(captured));
      }
      if (abort.signal.aborted) return;
      await persistDraft('sending');
      if (abort.signal.aborted) return;
      preparing = false;
      const response = await post<AnalyzeResponse>('/api/analyze', { images, lang }, abort.signal);
      if (!response || typeof response.id !== 'string' || !response.id.trim() || !response.analysis || !Array.isArray(response.analysis.action_items)) throw new ApiError(502, 'The model returned an invalid analysis response.');
      if (abort.signal.aborted) return;
      savedResultId = response.id;
      await persistDraft('result');
      if (!abort.signal.aborted) await goto(`/letters/${encodeURIComponent(response.id)}`);
    } catch (error) {
      if (!abort.signal.aborted) {
        uploadError = savedResultId ? 'analysisNavigation' : preparing ? 'resizeError'
          : error instanceof ApiError ? ({ configuration: 'analysisConfiguration', rateLimit: 'analysisRateLimit', invalidResponse: 'analysisInvalidResponse', unavailable: 'analysisUnavailable', timeout: 'analysisTimeout', storage: 'analysisStorage', invalidInput: 'analysisInvalidInput', generic: 'analysisError' } as const)[error.kind]
          : 'analysisNetwork';
        retryAfter = error instanceof ApiError ? error.retryAfter : null;
        requestId = error instanceof ApiError ? error.requestId : null;
        retryNow = Date.now(); retryUntil = retryAfter === null ? 0 : retryNow + retryAfter * 1000;
        void persistDraft(savedResultId ? 'result' : 'error');
      }
    }
    finally { if (controller === abort) { pending = false; preparing = false; } }
  }
  onDestroy(() => { disposed = true; draftRevision++; controller?.abort(); captures.forEach(item => URL.revokeObjectURL(item.url)); });
</script>

{#if pending || previewScanning}
  <Analyzing preview={captures[0]?.url} {preparing} oncancel={cancelAnalysis} />
{:else}
  <div class="space-y-6">
    <section class={focusedUpload ? 'mx-auto w-full max-w-xl' : ''}><div class="flex items-center justify-between gap-4"><h1 class="font-headline text-headline-lg-mobile text-primary md:text-headline-lg">{t(focusedUpload ? 'reviewPagesTitle' : 'greeting')}</h1>{#if !focusedUpload}<span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary-fixed text-on-secondary-fixed"><Icon name="sun" size={20} /></span>{/if}</div>{#if !focusedUpload}<p class="mt-1 text-body-md text-on-surface-variant">{t('homeIntro')}</p>{/if}</section>
    {#if activeCall && !focusedUpload}<section class="space-y-3 rounded-xl bg-primary p-4 text-white shadow-paper"><div class="flex items-start justify-between gap-3"><div><p class="eyebrow text-primary-fixed-dim">{t('activeCall')}</p><h2 class="mt-1 font-headline text-headline-md">{activeCall.senderName}</h2></div><span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary-fixed text-on-secondary-fixed"><Icon name="headset" /></span></div><div class="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3"><p class="text-body-sm text-primary-fixed-dim">{t(callSession.state)}</p><a href={`/calls/${encodeURIComponent(activeCall.id)}${demo ? '?demo=1' : ''}`} class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-secondary-fixed px-3 text-label-md text-on-secondary-fixed">{t('openCall')}<Icon name="phone" size={16} /></a></div></section>{/if}
    <div class={focusedUpload ? 'mx-auto w-full max-w-xl' : 'grid items-start gap-6 lg:grid-cols-[1.15fr_1fr]'}>
      <Card class="space-y-4">
        <input bind:this={cameraInput} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onchange={addFiles} />
        <input bind:this={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onchange={addFiles} />
        {#if !focusedUpload}
        <div class="flex items-center justify-between gap-2"><h2 class="font-headline text-headline-md text-primary">{t('capture')}</h2><span class="text-label-sm text-outline">{t('cameraOrFile')}</span></div>
        <button type="button" onclick={() => fileInput.click()} class="flex min-h-[176px] w-full flex-col items-center justify-center rounded-xl bg-surface-container-low p-4 text-center transition-colors hover:bg-surface-container"><span class="mb-3 flex size-12 items-center justify-center rounded-full bg-primary text-white"><Icon name="camera" size={24} /></span><span class="font-headline text-headline-sm text-primary">{t('upload')}</span><span class="mt-1 text-body-sm text-on-surface-variant">{t('uploadHint')}</span></button>
        <div class="grid grid-cols-2 gap-2">
          <Button variant="secondary" class="whitespace-nowrap" aria-label={t('camera')} onclick={() => cameraInput.click()}><Icon name="camera" size={18} />{t('cameraShort')}</Button>
          <Button variant="secondary" class="whitespace-nowrap" aria-label={t('chooseFiles')} onclick={() => fileInput.click()}><Icon name="folder" size={18} />{t('chooseFilesShort')}</Button>
        </div>
        {/if}
        {#if captures.length}
          <div><div class="flex items-center justify-between gap-2"><h2 class="text-label-lg text-primary">{t('pages', { count: captures.length })}</h2><button type="button" onclick={() => fileInput.click()} class="min-h-11 rounded-lg px-2 text-label-md text-secondary">{t('addPage')}</button></div>
            <div class="mt-1 grid gap-2.5 {captures.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'}">{#each captures as captured, index (captured.id)}<div class="rounded-xl bg-surface-container-low p-2.5"><img src={captured.url} alt={t('page', { number: index + 1 })} class="w-full rounded-lg bg-white object-contain {captures.length === 1 && !uploadError ? 'h-64' : 'h-40'}" /><div class="mt-1 flex items-center justify-between gap-1"><span class="text-label-md text-primary">{t('page', { number: index + 1 })}</span><button type="button" class="touch-icon text-on-surface-variant hover:bg-error-container hover:text-error" aria-label={t('removePage', { number: index + 1 })} onclick={() => removePage(captured.id)}><Icon name="close" size={17} /></button></div></div>{/each}</div>
          </div>
        {/if}
        {#if uploadError && errorSummary}<div role="alert" class="space-y-2 rounded-xl bg-error-container p-3 text-body-sm text-on-error-container"><p>{t(errorSummary)}</p>{#if ['analysisInterrupted', 'analysisNetwork', 'analysisStorage'].includes(uploadError)}<a href="/archive" class="inline-flex min-h-11 items-center font-medium underline">{t('checkArchive')}</a>{/if}<details class="text-[12px]"><summary class="cursor-pointer py-1">{t('errorDetails')}</summary><div class="mt-2 space-y-2"><p>{t(uploadError)}</p>{#if retryRemaining > 0}<p>{t('analysisRetryAfter', { seconds: retryRemaining })}</p>{/if}{#if uploadError !== 'imageOnly' && captures.length}<p>{t('uploadRetained')}</p>{/if}{#if requestId}<p class="data-value font-mono">{t('analysisRequestId', { id: requestId })}</p>{/if}</div></details></div>{/if}
        {#if recoveryUnavailable}<p role="status" class="text-[12px] text-outline">{t('uploadRecoveryUnavailableShort')}</p>{/if}
        {#if savedResultId}<a href={`/letters/${encodeURIComponent(savedResultId)}`} class="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-label-lg text-white">{t('openSavedResult')}<Icon name="arrow" /></a>{:else}<Button class="w-full" disabled={!captures.length || recoveryBusy || retryRemaining > 0} onclick={analyze}>{recoveryBusy ? t('preparing') : retryRemaining > 0 ? t('retryIn', { seconds: retryRemaining }) : t(captures.length === 0 ? 'analyzeEmpty' : captures.length === 1 ? 'analyzeOne' : 'analyze', { count: captures.length })}<Icon name="arrow" /></Button>{/if}
        {#if focusedUpload}<div class="flex items-start justify-between gap-3"><details class="min-w-0 text-[11px] leading-5 text-outline"><summary class="flex min-h-11 cursor-pointer items-center gap-1.5"><Icon name="lock" size={14} class="shrink-0" />{t('uploadInfo')}</summary><div class="max-w-prose space-y-2"><p>{t('privacy')}</p>{#if !demo}<p>{t('uploadRecoveryPrivacy')}</p>{/if}</div></details><button type="button" aria-label={t('discardPages')} class="min-h-11 shrink-0 rounded-lg px-2 text-[12px] text-outline hover:text-error" onclick={discardPages}>{t('discardShort')}</button></div>{:else}<p class="flex items-center justify-center gap-1.5 text-center text-[11px] leading-5 text-outline"><Icon name="lock" size={14} class="shrink-0" />{t('privacy')}</p>{/if}
        {#if demo && !focusedUpload}<div class="flex flex-col gap-2"><a href="/letters/demo-tax?demo=1" class="inline-flex min-h-12 items-center justify-center rounded-xl bg-secondary-container px-3 text-label-lg text-on-secondary-fixed">{t('previewOpen')}<Icon name="arrow" /></a><Button variant="quiet" onclick={() => previewScanning = true}>{t('previewAnalysis')}</Button></div>{/if}
      </Card>
      {#if !focusedUpload}
      <section class="space-y-3"><div class="section-heading"><h2 class="font-headline text-headline-sm text-primary">{t('recent')}</h2><a href={'/archive' + (demo ? '?demo=1' : '')} class="inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg text-label-md text-secondary">{t('toArchive')}<Icon name="arrow" size={16} /></a></div>
        {#if listLoading}<Card><p role="status" class="text-body-sm text-outline">{t('loading')}</p></Card>{:else if listError}<Card><p role="alert" class="mb-3 text-body-sm text-error">{t('error')}</p><Button variant="quiet" onclick={() => reload++}>{t('retry')}</Button></Card>{:else if !documents.length}<Card><Icon name="document" size={28} class="mb-3 text-outline" /><h3 class="font-headline text-headline-sm text-primary">{t('noLetters')}</h3><p class="mt-1 text-body-sm text-on-surface-variant">{t('noLettersHint')}</p></Card>{:else}{#each documents.slice(0, 3) as doc (doc.id)}<LetterCard {doc} detail={recentDetails[doc.id]} {demo} compact />{/each}<a href={'/archive' + (demo ? '?demo=1' : '')} class="flex min-h-12 items-center justify-center gap-2 rounded-xl text-label-md text-primary">{t('allLetters', { count: documents.length })}<Icon name="arrow" size={18} /></a>{/if}
      </section>
      {/if}
    </div>
  </div>
{/if}
