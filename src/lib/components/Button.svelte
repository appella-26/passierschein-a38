<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  let { children, variant = 'primary', class: className = '', ...rest }: HTMLButtonAttributes & { children?: Snippet; variant?: 'primary' | 'secondary' | 'quiet' | 'danger' } = $props();
  const variants = {
    primary: 'bg-primary text-on-primary hover:bg-primary-container',
    secondary: 'border border-surface-container-high bg-white text-primary hover:bg-surface-container-low',
    quiet: 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
    danger: 'bg-error text-on-error hover:bg-on-error-container'
  };
</script>

<button type="button" {...rest} class="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-label-lg transition-colors active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 {variants[variant]} {className}">{@render children?.()}</button>
