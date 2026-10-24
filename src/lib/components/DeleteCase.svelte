<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { ApiError, request } from '#lib/api.ts';
  import type { DocumentRow } from '#lib/types.ts';
  import { formatDate } from '#lib/format.ts';
  import { t } from '#lib/i18n.ts';
  import BottomSheet from './BottomSheet.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  let { caseId }: { caseId: string } = $props();
  let open = $state(false);
  let preview = $state<{ id: string; title: string; letters: DocumentRow[] } | null>(null);
  let loading = $state(false);
  let deleting = $state(false);
  let acknowledged = $state(false);
  let failure = $state<'caseDeleteLoadFailed' | 'caseDeleteFailed' | 'caseDeleteChanged' | null>(null);
  let controller: AbortController | undefined;
  let disposed = false;
  onDestroy(() => { disposed = true; controller?.abort(); });

  async function loadPreview() {
    controller?.abort();
    const abort = new AbortController();
    controller = abort;
    loading = true; preview = null; acknowledged = false; failure = null;
    try {
      const result = await request<{ id: string; title: string; letters: DocumentRow[] }>(`/api/cases/${encodeURIComponent(caseId)}`, { signal: abort.signal, cache: 'no-store' });
      if (!disposed && !abort.signal.aborted) preview = result;
    } catch { if (!disposed && !abort.signal.aborted) failure = 'caseDeleteLoadFailed'; }
    finally { if (!disposed && !abort.signal.aborted) loading = false; }
  }
  async function remove() {
    if (!preview || !acknowledged || deleting) return;
    const confirmed = preview;
    deleting = true; failure = null;
    try {
      const result = await request<{ cleanup_pending: boolean }>(`/api/cases/${encodeURIComponent(caseId)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ letter_ids: confirmed.letters.map(letter => letter.id) })
      });
      if (!disposed) await goto(`/archive?deleted=1${result.cleanup_pending ? '&cleanup=pending' : ''}`);
    } catch (error) {
      if (!disposed) {
        preview = null; acknowledged = false;
        failure = error instanceof ApiError && error.status === 409 ? 'caseDeleteChanged' : 'caseDeleteFailed';
      }
    } finally { if (!disposed) deleting = false; }
  }
</script>

<div class="border-t border-surface-container pt-2 text-center">
  <button type="button" class="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-body-sm text-outline hover:bg-error-container/30 hover:text-error" disabled={deleting} onclick={() => { open = true; void loadPreview(); }}><Icon name="trash" size={15} />{t('deleteCaseOption')}</button>
</div>
<BottomSheet bind:open title={t('deleteCaseTitle')} onclose={() => controller?.abort()}>
  {#if loading}<p role="status" class="text-body-sm text-outline">{t('loading')}</p>{/if}
  {#if preview}
    <h3 class="data-value font-headline text-headline-sm text-primary">{preview.title}</h3>
    <p class="prose-copy text-body-sm text-on-surface-variant">{t('deleteCaseWarning', { count: preview.letters.length })}</p>
    <ul class="space-y-2">{#each preview.letters as letter (letter.id)}<li class="rounded-xl bg-surface-container-low p-3"><p class="text-label-md text-primary">{letter.document_type}</p><p class="mt-1 text-body-sm text-on-surface-variant">{letter.sender_name}</p><p class="mt-1 text-[12px] text-outline">{t('receivedLabel')}: <time datetime={letter.created_at}>{formatDate(letter.created_at, true)}</time> · {t('pages', { count: letter.page_count })}</p></li>{/each}</ul>
    <label class="flex min-h-11 items-start gap-3 rounded-xl border border-surface-container p-3 text-body-sm text-primary"><input type="checkbox" class="mt-0.5 size-5 shrink-0 accent-error" bind:checked={acknowledged} disabled={deleting} /><span>{t('deleteCaseConsent')}</span></label>
  {/if}
  {#if failure}<div class="space-y-2 rounded-xl bg-error-container p-3"><p role="alert" class="text-body-sm text-on-error-container">{t(failure)}</p><Button variant="quiet" disabled={deleting || loading} onclick={loadPreview}>{t('reloadCase')}</Button></div>{/if}
  {#if deleting}<p role="status" class="text-body-sm text-outline">{t('caseDeleting')}</p>{/if}
  <div class="grid gap-3 sm:grid-cols-2"><Button variant="secondary" disabled={deleting} onclick={() => open = false}>{t('cancel')}</Button><Button variant="danger" disabled={!preview || !acknowledged || deleting || loading} onclick={remove}><Icon name="trash" size={18} />{t('deleteCaseConfirm')}</Button></div>
</BottomSheet>
