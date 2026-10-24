<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { GraphData, GraphNode, NodeKind } from '#lib/types.ts';
  import { request } from '#lib/api.ts';
  import { documentId, linkedDocuments, nodeColors } from '#lib/graph.ts';
  import { language, t } from '#lib/i18n.ts';
  import Card from '#lib/components/Card.svelte';
  import Button from '#lib/components/Button.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import GraphView from '#lib/components/GraphView.svelte';
  let data = $state<GraphData | null>(null);
  let loading = $state(true);
  let failed = $state(false);
  let selected = $state<GraphNode | null>(null);
  let reload = $state(0);
  const kinds: NodeKind[] = ['document', 'organization', 'reference', 'person', 'topic'];
  const demo = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1');
  const connections = $derived(data && selected ? linkedDocuments(data, selected) : []);
  const documents = $derived(data?.nodes.filter(node => node.kind === 'document') ?? []);
  $effect(() => {
    const isDemo = demo;
    const lang = isDemo ? language.current : 'en';
    void reload;
    const abort = new AbortController();
    loading = true; failed = false; selected = null;
    (async () => {
      try {
        const result = isDemo ? (await import('#lib/mock/data.ts')).mockGraph(lang) : await request<GraphData>('/api/graph', { signal: abort.signal });
        if (!abort.signal.aborted) data = result;
      } catch { if (!abort.signal.aborted) failed = true; }
      finally { if (!abort.signal.aborted) loading = false; }
    })();
    return () => abort.abort();
  });
  function selectNode(node: GraphNode) {
    const id = documentId(node);
    if (id) void goto(`/letters/${encodeURIComponent(id)}${demo ? '?demo=1' : ''}`);
    else selected = node;
  }
</script>

<svelte:head><title>{t('graph')} · {t('brand')}</title></svelte:head>
<div class="space-y-6">
  <section><h1 class="font-headline text-headline-lg-mobile text-primary md:text-headline-lg">{t('graphTitle')}</h1><p class="mt-2 text-body-md text-on-surface-variant">{t('graphIntro')}</p></section>
  {#if loading}<Card><p role="status" class="text-body-sm text-outline">{t('loading')}</p></Card>{:else if failed}<Card class="space-y-4"><p role="alert" class="text-body-sm text-error">{t('graphLoadError')}</p><Button onclick={() => reload++}>{t('retry')}</Button></Card>{:else if !data?.nodes.length}<Card class="py-10 text-center"><Icon name="graph" size={40} class="mx-auto mb-4 text-secondary" /><h2 class="font-headline text-headline-md text-primary">{t('graphEmpty')}</h2><p class="mx-auto mt-2 max-w-sm text-body-sm text-on-surface-variant">{t('graphEmptyHint')}</p><a href={'/' + (demo ? '?demo=1' : '')} class="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-label-lg text-white">{t('capture')}</a></Card>{:else}
    <Card class="space-y-4"><div class="flex flex-wrap gap-x-4 gap-y-2">{#each kinds as kind}<span class="inline-flex items-center gap-1.5 text-[11px] text-on-surface-variant"><span class="size-2.5 rounded-full" style:background={nodeColors[kind]}></span>{t(kind)}</span>{/each}</div><GraphView {data} onselect={selectNode} /><p class="text-body-sm text-on-surface-variant">{t('graphHint')}</p>
      <div class="flex items-start gap-3 rounded-xl bg-surface-container p-4" aria-live="polite"><span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-primary"><Icon name="info" size={18} /></span><div class="min-w-0"><h2 class="text-label-lg text-primary">{selected?.label ?? t('graphInspector')}</h2><p class="mt-1 text-body-sm text-on-surface-variant">{selected ? t('connections', { count: connections.length }) : t('graphSelect')}</p>{#if selected}<div class="mt-3 space-y-2">{#each connections as node}<a href={`/letters/${encodeURIComponent(documentId(node)!)}${demo ? '?demo=1' : ''}`} class="flex min-h-11 items-center gap-2 rounded-lg bg-white p-2 text-label-md text-primary"><Icon name="document" size={16} class="shrink-0" />{node.label}<Icon name="arrow" size={16} class="shrink-0" /></a>{/each}</div><button type="button" class="mt-2 min-h-11 rounded-lg px-2 text-label-md text-secondary" onclick={() => selected = null}>{t('close')}</button>{/if}</div></div>
    </Card>
    <Card class="space-y-3"><h2 class="font-headline text-headline-md text-primary">{t('connectedDocuments')}</h2><div class="grid gap-2 sm:grid-cols-2">{#each documents as node}<a href={`/letters/${encodeURIComponent(documentId(node)!)}${demo ? '?demo=1' : ''}`} class="flex min-h-12 items-center gap-2 rounded-xl bg-surface-container-low p-3 text-label-md text-primary"><Icon name="document" size={18} class="shrink-0" />{node.label}</a>{/each}</div><div class="flex flex-wrap gap-2">{#each data.nodes.filter(node => node.kind !== 'document') as node}<button type="button" onclick={() => selectNode(node)} aria-pressed={selected?.id === node.id} class="inline-flex min-h-11 items-center gap-2 rounded-full border border-surface-container px-3 text-left text-[11px] text-primary hover:bg-surface-container"><span class="size-2 shrink-0 rounded-full" style:background={nodeColors[node.kind]}></span>{node.label}</button>{/each}</div></Card>
  {/if}
</div>
