<script lang="ts">
  import { request } from '#lib/api.ts';
  import type { DocumentRow } from '#lib/types.ts';
  import { language, t } from '#lib/i18n.ts';
  import { formatDate } from '#lib/format.ts';
  import BottomSheet from './BottomSheet.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  let { open = $bindable(false), caseId, demo = false, revision = 0 }: { open?: boolean; caseId: string; demo?: boolean; revision?: number } = $props();
  let data = $state<{ id: string; title: string; letters: DocumentRow[] } | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let reload = $state(0);
  $effect(() => {
    const visible = open, id = caseId, preview = demo, lang = language.current;
    void revision; void reload;
    if (!visible) return;
    const abort = new AbortController();
    data = null; loading = true; failed = false;
    (async () => {
      try {
        if (preview) {
          const docs = (await import('#lib/mock/data.ts')).getMockDocuments(lang);
          const letters = id === 'demo-case' ? docs.filter(doc => ['demo-tax', 'demo-prior'].includes(doc.id)) : docs.filter(doc => id === `demo-case-${doc.id}`);
          if (!letters.length) throw new Error('Unknown preview case');
          if (!abort.signal.aborted) data = { id, title: letters[0].analysis.case_title, letters };
        } else {
          const result = await request<{ id: string; title: string; letters: DocumentRow[] }>(`/api/cases/${encodeURIComponent(id)}`, { signal: abort.signal, cache: 'no-store' });
          if (!abort.signal.aborted) data = result;
        }
      } catch { if (!abort.signal.aborted) failed = true; }
      finally { if (!abort.signal.aborted) loading = false; }
    })();
    return () => abort.abort();
  });
</script>

<BottomSheet bind:open title={data?.title ?? t('caseLabel')}>
  {#if loading}<p role="status" class="text-body-sm text-outline">{t('loading')}</p>
  {:else if failed}<p role="alert" class="text-body-sm text-error">{t('chatCaseFailed')}</p><Button variant="quiet" onclick={() => reload++}>{t('retry')}</Button>
  {:else if data}<div class="space-y-2">{#each data.letters as letter (letter.id)}<a href={`/letters/${encodeURIComponent(letter.id)}${demo ? '?demo=1' : ''}`} class="flex min-h-12 items-center gap-3 rounded-xl bg-surface-container-low p-3 text-primary"><Icon name="document" class="shrink-0" /><div class="min-w-0 flex-1"><p class="text-label-lg">{letter.document_type}</p><p class="mt-1 text-body-sm text-on-surface-variant">{letter.sender_name}{#if letter.letter_date} · {formatDate(letter.letter_date, true)}{/if}</p></div><Icon name="arrow" size={18} class="shrink-0" /></a>{:else}<p class="text-body-sm text-outline">{t('noLetters')}</p>{/each}</div><a href={`/assistant?case_id=${encodeURIComponent(data.id)}${demo ? '&demo=1' : ''}`} class="inline-flex min-h-11 items-center gap-2 text-label-md text-secondary"><Icon name="chat" size={18} />{t('chatAskCase')}</a>{/if}
</BottomSheet>
