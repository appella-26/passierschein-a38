<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { t } from '#lib/i18n.ts';
  import { post } from '#lib/api.ts';
  import { duration } from '#lib/format.ts';
  import { callSession, callStates, receiveEvent, terminalStates, watchCall } from '#lib/call-session.svelte.ts';
  import { enableSound, notification } from '#lib/notifications.svelte.ts';
  import Card from '#lib/components/Card.svelte';
  import Button from '#lib/components/Button.svelte';
  import Icon, { type IconName } from '#lib/components/Icon.svelte';
  import Timeline from '#lib/components/Timeline.svelte';

  let now = $state(Date.now());
  let cancelling = $state(false);
  let cancelError = $state(false);
  let soundError = $state(false);
  const demo = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1');
  const context = $derived(callSession.context?.id === page.params.id ? callSession.context : null);
  const callStatus = $derived(callSession.state);
  const terminal = $derived(terminalStates.includes(callStatus));
  const answered = $derived(['human_detected', 'transferring', 'connected'].includes(callStatus));
  const special = $derived(answered || callStatus === 'voicemail' || callStatus === 'failed' || callStatus === 'ended');
  const startedAt = $derived(callSession.events[0]?.at);
  const elapsed = $derived(startedAt ? (now - Date.parse(startedAt)) / 1000 : 0);
  const holdTime = $derived(callSession.events.reduce((seconds, event, index, events) => {
    if (event.state !== 'on_hold') return seconds;
    return seconds + Math.max(0, ((events[index + 1] ? Date.parse(events[index + 1].at) : now) - Date.parse(event.at)) / 1000);
  }, 0));
  const icon = $derived((answered ? 'phone' : callStatus === 'voicemail' ? 'voicemail' : callStatus === 'failed' ? 'warning' : callStatus === 'ended' ? 'check' : 'headset') as IconName);

  onMount(() => { const timer = setInterval(() => now = Date.now(), 1000); return () => clearInterval(timer); });
  $effect(() => {
    if (callStatus === 'human_detected') void tick().then(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  });
  async function cancel() {
    if (cancelling || terminal || !page.params.id) return;
    cancelling = true; cancelError = false;
    try {
      if (demo) receiveEvent({ state: 'ended', at: new Date().toISOString() });
      else {
        const result = await post<{ ok: boolean }>(`/api/calls/${encodeURIComponent(page.params.id)}/cancel`);
        if (!result.ok) cancelError = true;
        // Real call state comes from SSE, not from an optimistic UI transition.
      }
    } catch { cancelError = true; }
    finally { cancelling = false; }
  }
  async function activateSound() { soundError = !await enableSound(); }
</script>

<svelte:head><title>{t('liveCall')} · {t('brand')}</title></svelte:head>
<div class="space-y-6">
  {#if demo}<Card class="!p-3"><label for="demo-state" class="mb-2 block text-label-md text-primary">{t('demoCallState')}</label><select id="demo-state" class="paper-input" value={callStatus} onchange={event => receiveEvent({ state: event.currentTarget.value as typeof callStatus, at: new Date().toISOString() })}>{#each callStates as value}<option value={value}>{t(value)}</option>{/each}</select></Card>{/if}
  {#if callSession.connection === 'unavailable'}
    <Card class="space-y-4 text-center"><Icon name="warning" size={36} class="mx-auto text-error" /><h1 class="font-headline text-headline-lg-mobile text-primary">{t('notFound')}</h1><p class="text-body-md text-on-surface-variant">{t('callUnavailable')}</p><Button variant="quiet" onclick={() => watchCall(page.params.id ?? '', demo)}>{t('retry')}</Button></Card>
  {:else}
    {#if callSession.connection === 'reconnecting'}<p role="status" class="rounded-xl bg-tertiary-fixed p-3 text-body-sm text-on-tertiary-fixed-variant">{t('reconnecting')}</p>{/if}
    {#if special}
      <section class="flex min-h-[calc(100dvh-200px)] flex-col items-center justify-center rounded-2xl border p-5 text-center shadow-paper sm:min-h-[540px] {answered ? 'border-secondary-container bg-secondary-container/35' : callStatus === 'failed' ? 'border-error-container bg-error-container/25' : 'border-surface-container bg-white'}" aria-live="polite">
        <span class="mb-6 flex size-24 items-center justify-center rounded-full {answered ? 'bg-secondary text-white' : callStatus === 'failed' ? 'bg-error text-white' : 'bg-primary text-white'}"><Icon name={icon} size={42} /></span>
        <p class="eyebrow mb-3 {answered ? 'text-secondary' : callStatus === 'failed' ? 'text-error' : 'text-outline'}">{t(callStatus)}</p>
        <h1 class="max-w-md font-headline text-headline-xl-mobile text-primary sm:text-headline-xl">{t(answered && callStatus !== 'connected' ? 'humanTitle' : callStatus)}</h1>
        {#if context}<p class="mt-3 text-label-lg text-primary">{context.senderName}</p>{/if}
        <p class="mt-4 max-w-md text-body-md leading-relaxed text-on-surface-variant">{t(answered ? callStatus === 'connected' ? 'connectedHint' : 'humanHint' : callStatus === 'voicemail' ? 'voicemailHint' : callStatus === 'failed' ? 'failedHint' : 'endedHint')}</p>
        <div class="mt-7 flex w-full max-w-sm flex-col gap-3">{#if !terminal}<Button variant={answered ? 'secondary' : 'danger'} disabled={cancelling} onclick={cancel}><Icon name="close" size={19} />{t(cancelling ? 'cancellingCall' : 'cancelCall')}</Button>{/if}{#if context}<a href={`/letters/${encodeURIComponent(context.letterId)}${demo ? '?demo=1' : ''}`} class="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-4 text-label-lg text-primary"><Icon name="document" />{t('backToLetter')}</a>{/if}<a href={'/' + (demo ? '?demo=1' : '')} class="flex min-h-12 items-center justify-center rounded-xl text-label-lg text-primary">{t('overview')}</a></div>
      </section>
    {:else}
      <section class="space-y-5 rounded-2xl bg-primary p-5 text-white shadow-paper md:p-8">
        <div class="flex items-start justify-between gap-4"><div><p class="eyebrow text-primary-fixed-dim">{t('phoneAssistant')}</p><h1 class="mt-2 font-headline text-headline-lg-mobile md:text-headline-lg">{context?.senderName ?? t('liveCall')}</h1>{#if context}<p class="mt-2 font-mono text-body-sm text-primary-fixed-dim">{context.toNumber}</p>{/if}</div><span class="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-secondary-fixed"><Icon name="headset" size={27} /></span></div>
        <div class="flex items-center gap-2 text-label-lg" role="status"><span class="size-2 animate-pulse rounded-full bg-secondary-fixed"></span>{t(callStatus)}</div>
        <div class="rounded-xl border border-white/10 bg-white/5 p-5 text-center"><p class="eyebrow text-primary-fixed-dim">{t(callStatus === 'on_hold' ? 'waitingTime' : 'elapsed')}</p><p class="mt-2 font-headline text-[56px] leading-[64px] tabular-nums text-white" aria-live="off">{duration(callStatus === 'on_hold' ? holdTime : elapsed)}</p></div>
        <p class="text-body-sm text-primary-fixed-dim">{t('callWaitingHint')}</p>
      </section>
      <div class="grid gap-3 sm:grid-cols-2"><Button variant="danger" onclick={cancel} disabled={cancelling || callSession.connection === 'loading'}><Icon name="close" />{t(cancelling ? 'cancellingCall' : 'cancelCall')}</Button><a href={'/' + (demo ? '?demo=1' : '')} class="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-surface-container px-4 text-label-lg text-primary">{t('overview')}<Icon name="arrow" size={18} /></a></div>
    {/if}
    {#if cancelError}<p role="alert" class="rounded-xl bg-error-container p-3 text-body-sm text-on-error-container">{t('cancelFailed')}</p>{/if}
    {#if !terminal}<Card class="space-y-2"><Button variant="secondary" class="w-full" onclick={activateSound} disabled={notification.enabled}><Icon name="volume" />{t(notification.enabled ? 'soundEnabled' : 'enableSound')}</Button><p class="text-[11px] leading-5 text-outline">{t('soundHint')}</p>{#if soundError}<p role="status" class="text-body-sm text-outline">{t('soundUnavailable')}</p>{/if}</Card>{/if}
    <Card class="space-y-5"><h2 class="font-headline text-headline-md text-primary">{t('callTimeline')}</h2>{#if callSession.events.length}<Timeline events={callSession.events} />{:else}<p role="status" class="text-body-sm text-outline">{t('loading')}</p>{/if}</Card>
  {/if}
</div>
