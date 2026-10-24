<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import type { DocumentDetail, DocumentRow } from '#lib/types.ts';
  import { getDocument, request } from '#lib/api.ts';
  import { euroAmount, formatDate } from '#lib/format.ts';
  import { language, t, type TranslationKey } from '#lib/i18n.ts';
  import { checklist, isDocumentDone } from '#lib/checklist.svelte.ts';
  import Card from '#lib/components/Card.svelte';
  import Button from '#lib/components/Button.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import LetterCard from '#lib/components/LetterCard.svelte';

  type Filter = 'all' | 'openDeadlines' | 'taxOffice' | 'healthInsurance' | 'rent' | 'done';
  const filters: Filter[] = ['all', 'openDeadlines', 'taxOffice', 'healthInsurance', 'rent', 'done'];
  let query = $state('');
  let activeFilter = $state<Filter>('all');
  let documents = $state<DocumentRow[]>([]);
  let details = $state<Record<string, DocumentDetail>>({});
  let loading = $state(true);
  let failed = $state(false);
  let reload = $state(0);
  const demo = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1');
  onMount(() => query = page.url.searchParams.get('q') ?? '');

  function done(doc: DocumentRow) { const detail = details[doc.id]; return !!detail && isDocumentDone(doc.id, detail.analysis.action_items.length); }
  function matches(doc: DocumentRow, filter: Filter) {
    const text = `${doc.sender_name} ${doc.document_type} ${details[doc.id]?.analysis.keywords.join(' ') ?? ''}`.toLowerCase();
    if (filter === 'all') return true;
    if (filter === 'openDeadlines') return !!doc.deadline && !done(doc);
    if (filter === 'done') return done(doc);
    if (filter === 'taxOffice') return /finanzamt|steuer|tax/.test(text);
    if (filter === 'healthInsurance') return /krankenkasse|aok|barmer|health insurance|krankenversicherung/.test(text);
    return /miete|vermiet|hausverwaltung|nebenkosten|betriebskosten|rent|utilities/.test(text);
  }
  const visible = $derived(documents.filter(doc => matches(doc, activeFilter)));
  const open = $derived(documents.filter(doc => matches(doc, 'openDeadlines')));
  const nextDeadline = $derived(open.map(doc => doc.deadline!).sort()[0]);
  const amounts = $derived(documents.flatMap(doc => {
    const amount = euroAmount(details[doc.id]?.analysis.amount_due ?? null);
    return amount === null || done(doc) ? [] : [amount];
  }));
  const total = $derived(new Intl.NumberFormat(language.current === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(amounts.reduce((sum, amount) => sum + amount, 0)));

  $effect(() => {
    const q = query.trim();
    const isDemo = demo;
    void reload;
    const abort = new AbortController();
    loading = true; failed = false;
    const timer = setTimeout(async () => {
      try {
        const mock = isDemo ? await import('#lib/mock/data.ts') : null;
        const rows = mock ? mock.mockRows(q) : await request<DocumentRow[]>(`/api/documents${q ? '?q=' + encodeURIComponent(q) : ''}`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        documents = rows;
        loading = false;
        // List/search responses omit amounts and keywords. Hydrate details with bounded concurrency.
        let index = 0;
        await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
          while (index < rows.length && !abort.signal.aborted) {
            const row = rows[index++];
            try {
              const detail = mock ? mock.mockDocuments.find(doc => doc.id === row.id) : await getDocument(row.id, abort.signal);
              if (detail && !abort.signal.aborted) details[row.id] = detail;
            } catch { /* Basic archive cards remain readable if an individual detail request fails. */ }
          }
        }));
      } catch { if (!abort.signal.aborted) { failed = true; loading = false; } }
    }, q ? 250 : 0);
    return () => { abort.abort(); clearTimeout(timer); };
  });
</script>

<svelte:head><title>{t('archive')} · {t('brand')}</title></svelte:head>
<div class="space-y-5">
  <h1 class="font-headline text-headline-lg-mobile text-primary md:text-headline-lg">{t('archive')}</h1>
  <section class="space-y-3"><label class="sr-only" for="archive-search">{t('searchLabel')}</label><div class="relative"><Icon name="search" size={20} class="pointer-events-none absolute left-3.5 top-3.5 text-outline" /><input id="archive-search" type="search" class="paper-input border-surface-container !pl-11 !pr-14 shadow-paper" bind:value={query} placeholder={t('archiveSearch')} />{#if query}<button type="button" class="touch-icon absolute right-1 top-0.5 text-outline" onclick={() => query = ''} aria-label={t('clearSearch')}><Icon name="close" size={18} /></button>{/if}</div>
    <div class="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1" role="group" aria-label={t('resetFilters')}>{#each filters as filter}<button type="button" class="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-label-md shadow-paper {activeFilter === filter ? 'bg-primary text-white' : 'bg-white text-on-surface-variant hover:bg-surface-container'}" onclick={() => activeFilter = filter} aria-pressed={activeFilter === filter}>{#if filter === 'openDeadlines'}<span class="size-1.5 rounded-full bg-error"></span>{/if}{t(filter as TranslationKey)}<span class="rounded-full px-1.5 py-0.5 text-[10px] {activeFilter === filter ? 'bg-white/10' : 'bg-surface-container'}">{documents.filter(doc => matches(doc, filter)).length}</span></button>{/each}</div>
  </section>
  {#if !failed && !loading}<Card class="flex flex-wrap items-center justify-between gap-3 !p-3.5"><div class="flex items-center gap-3"><span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-tertiary-fixed text-on-tertiary-fixed-variant"><Icon name="calendar" size={22} /></span><div><p class="text-label-lg text-primary">{t('openDeadlineCount', { count: open.length })}</p>{#if nextDeadline}<p class="mt-1 text-body-sm text-on-surface-variant">{t('nextDue', { date: formatDate(nextDeadline) })}</p>{/if}</div></div>{#if amounts.length}<div class="text-right"><p class="eyebrow text-outline">{t('totalAmount')}</p><p class="font-headline text-headline-md text-primary">{total}</p></div>{/if}</Card>{/if}
  <section aria-busy={loading}>
    {#if loading}<Card><p role="status" class="text-body-sm text-outline">{t('loading')}</p></Card>{:else if failed}<Card class="space-y-3"><p role="alert" class="text-body-sm text-error">{t('error')}</p><Button onclick={() => reload++}>{t('retry')}</Button></Card>{:else if !visible.length}<Card class="py-10 text-center"><Icon name="search" size={32} class="mx-auto mb-4 text-outline" /><h2 class="font-headline text-headline-md text-primary">{t('noResults')}</h2><p class="mx-auto mt-2 max-w-sm text-body-sm text-on-surface-variant">{t('noResultsHint')}</p><Button class="mt-4" onclick={() => { query = ''; activeFilter = 'all'; }}>{t('resetFilters')}</Button></Card>{:else}<div class="grid items-start gap-3 md:grid-cols-2">{#each visible as doc (doc.id)}<LetterCard {doc} detail={details[doc.id]} {demo} completed={done(doc)} />{/each}</div>{/if}
  </section>
  <div class="sticky bottom-[104px] flex justify-center pt-2"><a href={'/' + (demo ? '?demo=1' : '')} class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-label-lg text-white shadow-paper hover:bg-primary-container"><Icon name="camera" size={22} />{t('newLetter')}</a></div>
  {#if Object.keys(checklist.completed).length}<p class="text-center text-[11px] text-outline">{t('localChecklist')}</p>{/if}
</div>
