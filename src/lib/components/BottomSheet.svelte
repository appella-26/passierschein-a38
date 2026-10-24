<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { t } from '#lib/i18n.ts';
  import Icon from './Icon.svelte';
  let { open = $bindable(false), title, children, onclose }: { open?: boolean; title: string; children: Snippet; onclose?: () => void } = $props();
  let dialog: HTMLDialogElement;
  let mounted = $state(false);
  function close() { open = false; onclose?.(); }
  onMount(() => { mounted = true; });
  $effect(() => {
    if (!mounted || !dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  });
</script>

<dialog bind:this={dialog} onclose={close} oncancel={close} aria-label={title} class="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border-0 bg-surface p-0 text-on-surface shadow-paper sm:inset-0 sm:m-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-2xl">
  <div class="sticky top-0 z-10 flex items-center gap-2 border-b border-surface-container bg-white px-4 py-3">
    <button type="button" class="touch-icon bg-surface-container text-primary" onclick={close} aria-label={t('close')}><Icon name="close" /></button>
    <h2 class="font-headline text-headline-md text-primary">{title}</h2>
  </div>
  <div class="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{@render children()}</div>
</dialog>

<style>dialog::backdrop { background: rgb(4 36 54 / 55%); }</style>
