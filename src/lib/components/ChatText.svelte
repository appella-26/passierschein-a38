<script lang="ts">
  import { splitRefs } from '#lib/assistant-client.ts';
  import type { ChatThread } from '#lib/chat-session.svelte.ts';
  let { content, refs, demo = false, oncase }: { content: string; refs: ChatThread['refs']; demo?: boolean; oncase: (id: string) => void } = $props();
  // Don't flash raw IDs while the model is halfway through a citation token.
  const segments = $derived(splitRefs(content.replace(/\[\[(?:letter|case):[^\]]*$/, ''), refs));
  function runs(text: string) {
    return text.split(/(\*\*[^*\n]+\*\*)/g).map(value => ({ bold: value.startsWith('**') && value.endsWith('**') && value.length > 4, value }));
  }
</script>

<div class="prose-copy whitespace-pre-wrap text-body-md">
  {#each segments as segment, index (index)}{#if segment.kind === 'text'}{#each runs(segment.text) as run}{#if run.bold}<strong class="font-semibold">{run.value.slice(2, -2)}</strong>{:else}<span>{run.value}</span>{/if}{/each}{:else if segment.kind === 'letter'}<a href={`/letters/${encodeURIComponent(segment.id)}${demo ? '?demo=1' : ''}`} class="mx-1 inline-flex min-h-11 max-w-full items-center rounded-lg border border-surface-container bg-white px-2.5 align-middle text-label-md text-secondary hover:bg-surface-container-low">{segment.label}</a>{:else}<button type="button" onclick={() => oncase(segment.id)} class="mx-1 inline-flex min-h-11 max-w-full items-center rounded-lg border border-surface-container bg-white px-2.5 text-left align-middle text-label-md text-secondary hover:bg-surface-container-low">{segment.label}</button>{/if}{/each}
</div>
