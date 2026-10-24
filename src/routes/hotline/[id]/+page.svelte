<script lang="ts">
  // Demo hotline (CALL_MODE=browser): this device plays the organisation being called.
  // It runs the same ElevenLabs agent over WebRTC, so no phone number or telephony account is needed.
  // The call screen on the user's device follows along through the usual report_status webhook and SSE.
  import { onDestroy } from 'svelte';
  import { page } from '$app/state';
  import type { VoiceConversation } from '@elevenlabs/client';
  import { t } from '#lib/i18n.ts';
  import { ApiError, post } from '#lib/api.ts';
  import type { CallEvent, CallState } from '#lib/types.ts';
  import Card from '#lib/components/Card.svelte';
  import Button from '#lib/components/Button.svelte';
  import Icon from '#lib/components/Icon.svelte';

  type Phase = 'ringing' | 'connecting' | 'live' | 'handed_over' | 'ended' | 'unavailable' | 'error';
  interface Session { conversationToken: string; dynamicVariables: Record<string, string>; senderName: string; userName: string }

  const id = $derived(page.params.id ?? '');
  let phase = $state<Phase>('ringing');
  let speaking = $state(false);
  let sender = $state('');
  let user = $state('');
  let conversation: VoiceConversation | undefined;
  let source: EventSource | undefined;
  let handoverPending = false;
  let handoverTimer: ReturnType<typeof setTimeout> | undefined;

  // Hand over once the agent has finished its introduction (it goes back to listening),
  // or after a safety delay if it keeps talking.
  const HANDOVER_PAUSE_MS = 1500;
  const HANDOVER_MAX_MS = 20000;

  function watchCall() {
    source?.close();
    source = new EventSource(`/api/calls/${encodeURIComponent(id)}/events`);
    source.onmessage = message => {
      let event: CallEvent;
      try { event = JSON.parse(message.data); } catch { return; }
      onCallState(event.state);
    };
  }

  function onCallState(state: CallState) {
    if (phase !== 'live') return;
    if (state === 'human_detected' || state === 'transferring') {
      if (handoverPending) return;
      handoverPending = true;
      handoverTimer = setTimeout(handOver, HANDOVER_MAX_MS);
      if (!speaking) scheduleHandover();
    } else if (state === 'ended' || state === 'failed') void leave('ended');
  }

  function scheduleHandover() {
    clearTimeout(handoverTimer);
    handoverTimer = setTimeout(handOver, HANDOVER_PAUSE_MS);
  }

  async function handOver() {
    if (phase !== 'live') return;
    await leave('handed_over');
    try { await post(`/api/calls/${encodeURIComponent(id)}/handover`); } catch { /* The call screen falls back to the transcript. */ }
  }

  async function leave(next: Phase) {
    clearTimeout(handoverTimer);
    phase = next;
    speaking = false;
    source?.close();
    const active = conversation;
    conversation = undefined;
    await active?.endSession().catch(() => {});
  }

  async function answer() {
    if (phase !== 'ringing' && phase !== 'error') return;
    phase = 'connecting';
    try {
      const session = await post<Session>(`/api/calls/${encodeURIComponent(id)}/session`);
      sender = session.senderName;
      user = session.userName;
      const { Conversation } = await import('@elevenlabs/client');
      conversation = await Conversation.startSession({
        conversationToken: session.conversationToken,
        connectionType: 'webrtc',
        dynamicVariables: session.dynamicVariables,
        textOnly: false,
        onConnect: ({ conversationId }) => { void post(`/api/calls/${encodeURIComponent(id)}/conversation`, { conversationId }).catch(() => {}); },
        onModeChange: ({ mode }) => {
          speaking = mode === 'speaking';
          if (!speaking && handoverPending) scheduleHandover();
          else if (speaking && handoverPending) { clearTimeout(handoverTimer); handoverTimer = setTimeout(handOver, HANDOVER_MAX_MS); }
        },
        onDisconnect: () => { if (phase === 'live' || phase === 'connecting') void leave('ended'); },
        onError: message => console.warn('[hotline]', message)
      }) as VoiceConversation;
      phase = 'live';
      watchCall();
    } catch (error) {
      await leave(error instanceof ApiError && (error.status === 404 || error.status === 409) ? 'unavailable' : 'error');
    }
  }

  onDestroy(() => { void leave('ended'); });
  const name = $derived(sender || t('hotlineTitle'));
</script>

<svelte:head><title>{t('hotlineTitle')} · {t('brand')}</title></svelte:head>
<div class="space-y-6">
  <section class="flex min-h-[calc(100dvh-220px)] flex-col items-center justify-center rounded-2xl border border-surface-container bg-white p-5 text-center shadow-paper sm:min-h-[480px]" aria-live="polite">
    <span class="mb-6 flex size-24 items-center justify-center rounded-full {phase === 'live' ? 'bg-secondary text-white' : phase === 'error' || phase === 'unavailable' ? 'bg-error text-white' : 'bg-primary text-white'}" class:animate-pulse={phase === 'ringing' || (phase === 'live' && speaking)}>
      <Icon name={phase === 'live' || phase === 'connecting' ? 'headset' : phase === 'error' || phase === 'unavailable' ? 'warning' : phase === 'ringing' ? 'phone' : 'check'} size={42} />
    </span>
    <p class="eyebrow mb-3 text-outline">{t('hotlineTitle')}</p>
    {#if phase === 'ringing' || phase === 'connecting'}
      <h1 class="font-headline text-headline-xl-mobile text-primary sm:text-headline-xl">{t('hotlineRinging')}</h1>
      <p class="mt-4 max-w-md text-body-md text-on-surface-variant">{t('hotlineIntro', { sender: name })}</p>
      <Button class="mt-7 w-full max-w-sm" onclick={answer} disabled={phase === 'connecting'}><Icon name="phone" />{t(phase === 'connecting' ? 'answeringCall' : 'answerCall')}</Button>
    {:else if phase === 'live'}
      <h1 class="font-headline text-headline-xl-mobile text-primary sm:text-headline-xl">{t('hotlineRole', { sender: name })}</h1>
      <p class="mt-3 text-label-lg text-secondary" role="status">{t(speaking ? 'agentSpeaking' : 'agentListening')}</p>
      <p class="mt-4 max-w-md text-body-md text-on-surface-variant">{t('hotlineHint', { user })}</p>
      <Button variant="danger" class="mt-7 w-full max-w-sm" onclick={() => leave('ended')}><Icon name="close" />{t('hangUp')}</Button>
    {:else if phase === 'handed_over'}
      <h1 class="font-headline text-headline-xl-mobile text-primary sm:text-headline-xl">{t('hotlineHandedOver', { user })}</h1>
      <p class="mt-4 max-w-md text-body-md text-on-surface-variant">{t('hotlineHandedOverHint', { user })}</p>
    {:else if phase === 'ended'}
      <h1 class="font-headline text-headline-xl-mobile text-primary sm:text-headline-xl">{t('hotlineEnded')}</h1>
    {:else}
      <h1 class="font-headline text-headline-lg-mobile text-primary">{t(phase === 'unavailable' ? 'hotlineUnavailable' : 'hotlineError')}</h1>
      {#if phase === 'error'}<Button variant="quiet" class="mt-6" onclick={answer}>{t('retry')}</Button>{/if}
    {/if}
  </section>
  {#if phase === 'ringing' || phase === 'connecting' || phase === 'live'}
    <Card class="space-y-3">
      <ol class="space-y-2.5">{#each ['hotlineStep1', 'hotlineStep2', 'hotlineStep3', 'hotlineStep4'] as step, index}<li class="flex items-start gap-2 text-body-sm text-on-surface-variant"><span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] text-white">{index + 1}</span>{t(step as 'hotlineStep1', { sender: name, user: user || '…' })}</li>{/each}</ol>
    </Card>
  {/if}
</div>
