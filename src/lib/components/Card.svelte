<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children, class: className = '' }: { children: Snippet; class?: string } = $props();
</script>

<div class="rounded-xl border border-surface-container bg-surface-container-lowest p-4 shadow-paper {className}">{@render children()}</div>
