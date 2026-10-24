<script lang="ts">
  import type ForceGraph from 'force-graph';
  import type { NodeObject } from 'force-graph';
  import { forceCollide, forceX, forceY } from 'd3-force';
  import type { GraphData, GraphNode, GraphLink } from '#lib/types.ts';
  import { nodeColors } from '#lib/graph.ts';
  import { t } from '#lib/i18n.ts';
  import Icon from './Icon.svelte';
  type ForceNode = GraphNode & NodeObject;
  type ForceLink = Omit<GraphLink, 'source' | 'target'> & { source: string | ForceNode; target: string | ForceNode };
  let { data, onselect }: { data: GraphData; onselect: (node: GraphNode) => void } = $props();
  let host = $state<HTMLDivElement>();
  let graph = $state.raw<ForceGraph<ForceNode, ForceLink>>();
  let failed = $state(false);
  let ready = $state(false);
  let reload = $state(0);

  $effect(() => {
    const element = host;
    const dataset = data;
    void reload;
    if (!element || !dataset.nodes.length) return;
    let disposed = false;
    let instance: ForceGraph<ForceNode, ForceLink> | undefined;
    let observer: ResizeObserver | undefined;
    failed = false; ready = false;
    (async () => {
      try {
        const { default: ForceGraphConstructor } = await import('force-graph');
        if (disposed) return;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const styles = getComputedStyle(document.documentElement);
        const colors = Object.fromEntries(Object.entries(nodeColors).map(([kind, token]) => [kind, styles.getPropertyValue(token.slice(4, -1)).trim()]));
        const surface = styles.getPropertyValue('--color-surface-container-low').trim();
        const outline = styles.getPropertyValue('--color-outline-variant').trim();
        const ink = styles.getPropertyValue('--color-primary').trim();
        const bounds = new Map<string, { width: number; height: number; x: number; y: number }>();
        let fitted = false;
        instance = new ForceGraphConstructor<ForceNode, ForceLink>(element)
          .width(element.clientWidth).height(element.clientHeight)
          .backgroundColor(surface).nodeColor(node => colors[node.kind])
          .nodeLabel(node => { const label = document.createElement('span'); label.textContent = node.label; return label; })
          .linkColor(() => outline).linkWidth(1.2)
          .linkLineDash(link => link.role === 'mentions' ? [3, 3] : null)
          .minZoom(0.05).maxZoom(4).warmupTicks(150).cooldownTicks(reducedMotion ? 1 : 60)
          .nodeCanvasObject((node, ctx, scale) => {
            const x = node.x ?? 0, y = node.y ?? 0;
            const compact = scale < 0.65;
            const font = (compact ? 9 : 11) / scale;
            const limit = compact ? 10 : 27;
            const text = node.label.length > limit ? node.label.slice(0, limit - 1) + '…' : node.label;
            ctx.font = `500 ${font}px "Plus Jakarta Sans", sans-serif`;
            const width = ctx.measureText(text).width + 28 / scale;
            const height = (compact ? 24 : 32) / scale;
            ctx.beginPath(); ctx.roundRect(x - width / 2, y - height / 2, width, height, 12 / scale);
            ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = outline; ctx.lineWidth = 1 / scale; ctx.stroke();
            ctx.beginPath(); ctx.arc(x - width / 2 + 12 / scale, y, 5 / scale, 0, Math.PI * 2); ctx.fillStyle = colors[node.kind]; ctx.fill();
            ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x - width / 2 + 22 / scale, y);
            bounds.set(node.id, { x, y, width, height });
          })
          .nodePointerAreaPaint((node, color, ctx, scale) => {
            const box = bounds.get(node.id);
            if (!box) return;
            ctx.fillStyle = color;
            const height = Math.max(box.height, 44 / scale);
            const width = Math.max(box.width, 44 / scale);
            ctx.fillRect(box.x - width / 2, box.y - height / 2, width, height);
          })
          .onNodeClick(node => onselect(node))
          .onEngineStop(() => { if (!fitted && !disposed) { instance?.zoomToFit(0, 56); fitted = true; ready = true; } })
          // force-graph mutates nodes and resolves link IDs into objects. Keep API data untouched.
          .graphData({ nodes: dataset.nodes.map(node => ({ ...node })), links: dataset.links.map(link => ({ ...link })) });
        instance.d3Force('charge')?.strength?.(-100);
        instance.d3Force('link')?.distance?.(100);
        instance.d3Force('collision', forceCollide<ForceNode>(88).strength(0.9).iterations(3));
        // Gently bring disconnected groups together without shortening links or weakening collision protection.
        instance.d3Force('x', forceX<ForceNode>(0).strength(0.015));
        instance.d3Force('y', forceY<ForceNode>(0).strength(0.015));
        instance.d3ReheatSimulation();
        graph = instance;
        observer = new ResizeObserver(entries => {
          const { width, height } = entries[0].contentRect;
          instance?.width(width).height(height).zoomToFit(0, 56);
        });
        observer.observe(element);
      } catch { if (!disposed) failed = true; }
    })();
    return () => { disposed = true; observer?.disconnect(); instance?._destructor(); graph = undefined; };
  });
</script>

<div class="relative">
  <div bind:this={host} class="h-[380px] w-full overflow-hidden rounded-xl bg-surface-container-low md:h-[500px]" role="img" aria-label={t('graphCanvas')}></div>
  {#if !ready}<div class="absolute inset-0 flex items-center justify-center p-4 text-center text-body-sm text-outline" role="status">{#if failed}<div><p>{t('graphLoadError')}</p><button type="button" class="mt-3 min-h-11 rounded-xl bg-primary px-4 text-label-md text-white" onclick={() => reload++}>{t('retry')}</button></div>{:else}{t('loading')}{/if}</div>{/if}
  <div class="mt-2 flex justify-end"><div class="flex gap-1 rounded-xl border border-surface-container bg-white p-1 shadow-paper"><button type="button" class="touch-icon text-primary" disabled={!ready} aria-label={t('zoomOut')} onclick={() => graph?.zoom(Math.max(0.05, graph.zoom() / 1.3), 0)}><Icon name="minus" /></button><button type="button" class="touch-icon text-primary" disabled={!ready} aria-label={t('zoomIn')} onclick={() => graph?.zoom(Math.min(4, graph.zoom() * 1.3), 0)}><Icon name="plus" /></button><button type="button" class="touch-icon text-primary" disabled={!ready} aria-label={t('resetGraph')} onclick={() => graph?.zoomToFit(0, 56)}><Icon name="scan" /></button></div></div>
</div>
