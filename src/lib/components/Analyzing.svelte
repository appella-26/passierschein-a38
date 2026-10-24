<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n.ts';
  import Icon from './Icon.svelte';
  import Card from './Card.svelte';
  import Button from './Button.svelte';
  let { preview, preparing = false, oncancel }: { preview?: string; preparing?: boolean; oncancel: () => void } = $props();
  onMount(() => window.scrollTo({ top: 0, behavior: 'instant' }));
</script>

<div class="space-y-5" aria-busy="true">
  <div class="flex flex-wrap items-center justify-between gap-2"><span role="status" class="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-3 py-2 text-label-md"><span class="size-2 animate-pulse rounded-full bg-secondary"></span>{t(preparing ? 'preparing' : 'analyzing')}</span><span class="inline-flex items-center gap-1 text-label-sm text-on-surface-variant"><Icon name="lock" size={16} />{t('analyzingPrivate')}</span></div>
  <div class="grid gap-5 md:grid-cols-[1fr_1.1fr]">
    <div class="relative mx-auto aspect-[3/4] max-h-[400px] w-full overflow-hidden rounded-2xl border border-surface-container bg-white p-5 shadow-paper">
      {#if preview}<img src={preview} alt={t('page', { number: 1 })} class="absolute inset-0 size-full object-contain opacity-65" />{:else}<div class="space-y-5 pt-5" aria-hidden="true"><div class="h-3 w-32 rounded bg-outline-variant/60"></div><div class="space-y-2"><div class="h-2 w-24 rounded bg-surface-container-highest"></div><div class="h-2 w-36 rounded bg-surface-container-highest"></div></div><div class="h-10 rounded bg-surface-container-low"></div><div class="space-y-3">{#each Array(8) as _, i}<div class="h-2 rounded bg-outline-variant/40" style:width={`${100 - i % 3 * 12}%`}></div>{/each}</div></div>{/if}
      <div class="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-label-sm text-white"><Icon name="scan" size={15} />{t('scanActive')}</div>
      <div class="scan-line absolute inset-x-0 h-0.5 bg-secondary/75" aria-hidden="true"></div>
      <div class="absolute bottom-3 left-3 size-4 border-b-2 border-l-2 border-primary/30" aria-hidden="true"></div>
      <div class="absolute bottom-3 right-3 size-4 border-b-2 border-r-2 border-primary/30" aria-hidden="true"></div>
    </div>
    <div class="space-y-5">
      <div class="flex items-start gap-3 rounded-xl bg-secondary-container/40 p-4"><span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary-container text-secondary"><Icon name="leaf" /></span><div><h2 class="text-label-lg text-on-secondary-fixed-variant">{t('stayCalm')}</h2><p class="mt-1 text-body-sm text-on-secondary-fixed-variant">{t('stayCalmHint')}</p></div></div>
      <Card><h2 class="eyebrow mb-4 text-primary">{t('analysisPipeline')}</h2><ol class="space-y-4">
        {#each [{ title: 'imageReady', hint: 'imageReadyHint' }, { title: 'extracting', hint: 'extractingHint' }, { title: 'summaryPreparing', hint: 'summaryPreparingHint' }, { title: 'linking', hint: 'linkingHint' }] as step, index}
          <li class="flex gap-3" class:opacity-50={index > (preparing ? 0 : 1)}><span class="flex size-6 shrink-0 items-center justify-center rounded-full {index === 0 && !preparing ? 'bg-secondary text-white' : 'bg-surface-container text-primary'}">{#if index === 0 && !preparing}<Icon name="check" size={15} />{:else if index === (preparing ? 0 : 1)}<span class="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>{:else}<span class="size-1.5 rounded-full bg-outline"></span>{/if}</span><div><p class="text-label-md text-primary">{t(step.title as 'imageReady')}</p><p class="mt-1 text-body-sm text-outline">{t(step.hint as 'imageReadyHint')}</p></div></li>
        {/each}
      </ol></Card>
      <p class="flex items-start gap-2 text-body-sm text-outline"><Icon name="clock" size={18} class="shrink-0" />{t('analysisWait')}</p>
    </div>
  </div>
  <div class="flex flex-col items-center gap-2"><Button variant="quiet" onclick={oncancel}><Icon name="close" />{t('cancelAnalysis')}</Button><p class="max-w-md text-center text-[11px] leading-5 text-outline">{t('cancelAnalysisHint')}</p></div>
</div>

<style>@keyframes scan { from { top: 8%; } to { top: 92%; } } .scan-line { animation: scan 2.6s ease-in-out infinite alternate; }</style>
