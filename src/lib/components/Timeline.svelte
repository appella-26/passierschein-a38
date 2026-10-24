<script lang="ts">
  import type { CallEvent } from '#lib/server/calls.ts';
  import { language, t } from '#lib/i18n.ts';
  import Icon from './Icon.svelte';
  let { events }: { events: CallEvent[] } = $props();
</script>

<ol class="space-y-0" aria-label={t('callTimeline')}>
  {#each events as event, index (`${event.at}-${index}`)}
    <li class="relative flex gap-3 pb-5 last:pb-0">
      {#if index < events.length - 1}<span class="absolute left-[13px] top-7 h-[calc(100%-28px)] w-px bg-outline-variant"></span>{/if}
      <span class="relative flex size-7 shrink-0 items-center justify-center rounded-full {event.state === 'failed' ? 'bg-error-container text-error' : index === events.length - 1 ? 'bg-primary text-white' : 'bg-secondary-container text-secondary'}"><Icon name={event.state === 'failed' ? 'close' : index === events.length - 1 ? 'phone' : 'check'} size={16} /></span>
      <div class="min-w-0 flex-1"><p class="text-label-lg text-primary">{t(event.state)}</p>{#if event.note}<p class="mt-1 text-body-sm text-on-surface-variant">{event.note}</p>{/if}</div>
      <time datetime={event.at} class="shrink-0 pt-1 text-label-sm tabular-nums text-outline">{new Intl.DateTimeFormat(language.current, { hour: '2-digit', minute: '2-digit' }).format(new Date(event.at))}</time>
    </li>
  {/each}
</ol>
