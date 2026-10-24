<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { t, language } from '#lib/i18n.ts';
  import { getDocument, request, post } from '#lib/api.ts';
  import { fileToBase64Jpeg } from '#lib/resize.ts';
  import type { AnalyzeResponse, DocumentDetail, DocumentRow } from '#lib/types.ts';
  import Button from '#lib/components/Button.svelte';
  import Card from '#lib/components/Card.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import LetterCard from '#lib/components/LetterCard.svelte';
  import Analyzing from '#lib/components/Analyzing.svelte';
  import { callSession, terminalStates } from '#lib/call-session.svelte.ts';

  type CapturedPage = { id: number; file: File; url: string };
  let captures = $state<CapturedPage[]>([]);
  let cameraInput = $state<HTMLInputElement>(null!);
  let fileInput = $state<HTMLInputElement>(null!);
  let sequence = 0;
  let pending = $state(false);
  let preparing = $state(false);
  let previewScanning = $state(false);
  let uploadError = $state<'imageOnly' | 'analysisError' | 'resizeError' | null>(null);
  let documents = $state<DocumentRow[]>([]);
  let recentDetails = $state<Record<string, DocumentDetail>>({});
  let listError = $state(false);
  let listLoading = $state(true);
  let reload = $state(0);
  let controller: AbortController | undefined;
  const demo = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1');
  const activeCall = $derived(callSession.context && !!callSession.context.demo === demo && callSession.connection !== 'unavailable' && !terminalStates.includes(callSession.state) ? callSession.context : null);

  $effect(() => {
    const isDemo = demo;
    void reload;
    const abort = new AbortController();
    listLoading = true;
    listError = false;
    (async () => {
      try {
        const mock = isDemo ? await import('#lib/mock/data.ts') : null;
        const rows = mock ? mock.mockRows() : await request<DocumentRow[]>('/api/documents', { signal: abort.signal });
        if (abort.signal.aborted) return;
        documents = rows;
        listLoading = false;
        await Promise.all(rows.slice(0, 3).map(async row => {
          try {
            const detail = mock ? mock.mockDocuments.find(doc => doc.id === row.id) : await getDocument(row.id, abort.signal);
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
    uploadError = null;
    for (const file of Array.from(input.files ?? [])) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { uploadError = 'imageOnly'; continue; }
      captures.push({ id: ++sequence, file, url: URL.createObjectURL(file) });
    }
    input.value = '';
  }
  function removePage(id: number) {
    const captured = captures.find(item => item.id === id);
    if (captured) URL.revokeObjectURL(captured.url);
    captures = captures.filter(item => item.id !== id);
  }
  function cancelAnalysis() { controller?.abort(); pending = false; preparing = false; previewScanning = false; }
  async function analyze() {
    if (!captures.length || pending) return;
    if (demo) { await goto('/letters/demo-tax?demo=1'); return; }
    const abort = new AbortController();
    controller = abort;
    uploadError = null;
    pending = true;
    preparing = true;
    const lang = language.current;
    try {
      const images: string[] = [];
      for (const captured of captures) {
        if (abort.signal.aborted) return;
        images.push(await fileToBase64Jpeg(captured.file));
      }
      if (abort.signal.aborted) return;
      preparing = false;
      const response = await post<AnalyzeResponse>('/api/analyze', { images, lang }, abort.signal);
      if (!abort.signal.aborted) await goto(`/letters/${encodeURIComponent(response.id)}`);
    } catch { if (!abort.signal.aborted) uploadError = preparing ? 'resizeError' : 'analysisError'; }
    finally { if (controller === abort) { pending = false; preparing = false; } }
  }
  onDestroy(() => { controller?.abort(); captures.forEach(item => URL.revokeObjectURL(item.url)); });
</script>

{#if pending || previewScanning}
  <Analyzing preview={captures[0]?.url} {preparing} oncancel={cancelAnalysis} />
{:else}
  <div class="space-y-5 md:space-y-7">
    <section><div class="flex items-center justify-between gap-4"><h1 class="font-headline text-headline-lg-mobile text-primary md:text-headline-lg">{t('greeting')}</h1><span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary-fixed text-on-secondary-fixed"><Icon name="sun" size={20} /></span></div><p class="mt-1 text-body-md text-on-surface-variant">{t('homeIntro')}</p></section>
    {#if activeCall}<section class="space-y-3 rounded-xl bg-primary p-4 text-white shadow-paper"><div class="flex items-start justify-between gap-3"><div><p class="eyebrow text-primary-fixed-dim">{t('activeCall')}</p><h2 class="mt-1 font-headline text-headline-md">{activeCall.senderName}</h2></div><span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary-fixed text-on-secondary-fixed"><Icon name="headset" /></span></div><div class="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3"><p class="text-body-sm text-primary-fixed-dim">{t(callSession.state)}</p><a href={`/calls/${encodeURIComponent(activeCall.id)}${demo ? '?demo=1' : ''}`} class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-secondary-fixed px-3 text-label-md text-on-secondary-fixed">{t('openCall')}<Icon name="phone" size={16} /></a></div></section>{/if}
    <div class="grid items-start gap-6 md:grid-cols-[1.15fr_1fr]">
      <Card class="space-y-4">
        <div class="flex items-center justify-between gap-2"><h2 class="font-headline text-headline-md text-primary">{t('capture')}</h2><span class="text-label-sm text-outline">{t('cameraOrFile')}</span></div>
        <input bind:this={cameraInput} class="sr-only" tabindex="-1" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onchange={addFiles} aria-label={t('camera')} />
        <input bind:this={fileInput} class="sr-only" tabindex="-1" type="file" accept="image/jpeg,image/png,image/webp" multiple onchange={addFiles} aria-label={t('chooseFiles')} />
        <button type="button" onclick={() => fileInput.click()} class="flex min-h-[176px] w-full flex-col items-center justify-center rounded-xl bg-surface-container-low p-4 text-center transition-colors hover:bg-surface-container"><span class="mb-3 flex size-12 items-center justify-center rounded-full bg-primary text-white"><Icon name="camera" size={24} /></span><span class="font-headline text-headline-sm text-primary">{t('upload')}</span><span class="mt-1 text-body-sm text-on-surface-variant">{t('uploadHint')}</span></button>
        <div class="grid grid-cols-2 gap-2"><Button variant="secondary" onclick={() => cameraInput.click()}><Icon name="camera" size={18} />{t('camera')}</Button><Button variant="secondary" onclick={() => fileInput.click()}><Icon name="folder" size={18} />{t('chooseFiles')}</Button></div>
        {#if captures.length}
          <div><div class="flex items-center justify-between gap-2"><h3 class="text-label-md text-primary">{t('pages', { count: captures.length })}</h3><button type="button" onclick={() => fileInput.click()} class="min-h-11 rounded-lg px-2 text-label-md text-secondary">{t('addPage')}</button></div>
            <div class="mt-1 grid grid-cols-2 gap-2.5">{#each captures as captured, index (captured.id)}<div class="rounded-xl bg-surface-container-low p-2.5"><img src={captured.url} alt={t('page', { number: index + 1 })} class="h-28 w-full rounded-lg bg-white object-cover" /><div class="mt-1 flex items-center justify-between gap-1"><span class="text-label-md text-primary">{t('page', { number: index + 1 })}</span><button type="button" class="touch-icon text-on-surface-variant hover:bg-error-container hover:text-error" aria-label={t('removePage', { number: index + 1 })} onclick={() => removePage(captured.id)}><Icon name="close" size={17} /></button></div></div>{/each}</div>
          </div>
        {/if}
        {#if uploadError}<p role="alert" class="rounded-xl bg-error-container p-3 text-body-sm text-on-error-container">{t(uploadError)}</p>{/if}
        <Button class="w-full" disabled={!captures.length} onclick={analyze}>{t(captures.length === 0 ? 'analyzeEmpty' : captures.length === 1 ? 'analyzeOne' : 'analyze', { count: captures.length })}<Icon name="arrow" /></Button>
        <p class="flex items-center justify-center gap-1.5 text-center text-[11px] leading-5 text-outline"><Icon name="lock" size={14} class="shrink-0" />{t('privacy')}</p>
        {#if demo}<div class="flex flex-col gap-2"><a href="/letters/demo-tax?demo=1" class="inline-flex min-h-12 items-center justify-center rounded-xl bg-secondary-container px-3 text-label-lg text-on-secondary-fixed">{t('previewOpen')}<Icon name="arrow" /></a><Button variant="quiet" onclick={() => previewScanning = true}>{t('previewAnalysis')}</Button></div>{/if}
      </Card>
      <section class="space-y-3"><div class="flex items-center justify-between gap-3"><h2 class="font-headline text-headline-sm text-primary">{t('recent')}</h2><a href={'/archive' + (demo ? '?demo=1' : '')} class="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-1 text-label-md text-secondary">{t('toArchive')}<Icon name="arrow" size={16} /></a></div>
        {#if listLoading}<Card><p role="status" class="text-body-sm text-outline">{t('loading')}</p></Card>{:else if listError}<Card><p role="alert" class="mb-3 text-body-sm text-error">{t('error')}</p><Button variant="quiet" onclick={() => reload++}>{t('retry')}</Button></Card>{:else if !documents.length}<Card><Icon name="document" size={28} class="mb-3 text-outline" /><h3 class="font-headline text-headline-sm text-primary">{t('noLetters')}</h3><p class="mt-1 text-body-sm text-on-surface-variant">{t('noLettersHint')}</p></Card>{:else}{#each documents.slice(0, 3) as doc (doc.id)}<LetterCard {doc} detail={recentDetails[doc.id]} {demo} compact />{/each}<a href={'/archive' + (demo ? '?demo=1' : '')} class="flex min-h-12 items-center justify-center gap-2 rounded-xl text-label-md text-primary">{t('allLetters', { count: documents.length })}<Icon name="arrow" size={18} /></a>{/if}
      </section>
    </div>
  </div>
{/if}
