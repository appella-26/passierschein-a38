<script lang="ts">
  // Browser rehearsal: the separate "Appella Browser Rehearsal" agent runs on this device over WebRTC.
  // Someone in the room plays the tax office hotline into the microphone. The agent reports what it
  // hears through its report_browser_status client tool; nobody is dialled and nothing is transferred.
  import { onDestroy, onMount } from 'svelte';
  import type { VoiceConversation } from '@elevenlabs/client';
  import { language, t, type TranslationKey } from '#lib/i18n.ts';
  import { ApiError, post, request } from '#lib/api.ts';
  import { addStep, type RehearsalStep } from '#lib/rehearsal.ts';
  import Card from '#lib/components/Card.svelte';
  import Button from '#lib/components/Button.svelte';
  import Icon from '#lib/components/Icon.svelte';

  type Phase = 'loading' | 'unconfigured' | 'ready' | 'connecting' | 'live' | 'taken_over' | 'voicemail' | 'ended' | 'error' | 'mic_denied';
  interface Line { role: 'agent' | 'hotline'; text: string }

  const SCRIPT = [
    { label: 'rehearsalScriptMenu', text: 'Willkommen beim Finanzamt. Für Fragen zu Ihrem Bescheid wählen Sie die Eins.' },
    { label: 'rehearsalScriptHold', text: 'Bitte bleiben Sie in der Leitung.', pause: true },
    { label: 'rehearsalScriptHuman', text: 'Finanzamt, Müller am Apparat, guten Tag. Wie kann ich Ihnen helfen?' }
  ] as const;
  const PROGRESS = ['ivr', 'on_hold', 'human_detected'] as const;

  let phase = $state<Phase>('loading');
  let speaking = $state(false);
  let steps = $state<RehearsalStep[]>([]);
  let lines = $state<Line[]>([]);
  let conversation: VoiceConversation | undefined;

  const humanAnswered = $derived(steps.some(step => step.state === 'human_detected'));
  const voicemail = $derived(steps.some(step => step.state === 'voicemail'));
  const shown = $derived(voicemail ? [...PROGRESS.filter(state => steps.some(step => step.state === state)), 'voicemail' as const] : PROGRESS);
  const stepFor = (state: string) => steps.find(step => step.state === state);
  const time = (at: string) => new Intl.DateTimeFormat(language.current, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(at));

  async function stop(next: Phase) {
    phase = next;
    speaking = false;
    const active = conversation;
    conversation = undefined;
    await active?.endSession().catch(() => {});
  }

  async function start() {
    if (phase === 'loading' || phase === 'unconfigured' || phase === 'connecting' || phase === 'live') return;
    phase = 'connecting';
    steps = [];
    lines = [];
    try {
      const { conversationToken } = await post<{ conversationToken: string }>('/api/rehearsal');
      const { Conversation } = await import('@elevenlabs/client');
      conversation = await Conversation.startSession({
        conversationToken,
        connectionType: 'webrtc',
        clientTools: {
          report_browser_status: (params: unknown) => { steps = addStep(steps, params); return 'ok'; }
        },
        onModeChange: ({ mode }) => { speaking = mode === 'speaking'; },
        onMessage: ({ message, role }) => {
          const text = message?.trim();
          if (text) lines = [...lines, { role: role === 'agent' ? 'agent' : 'hotline', text } satisfies Line].slice(-6);
        },
        onDisconnect: () => {
          conversation = undefined;
          speaking = false;
          if (phase === 'live' || phase === 'connecting') phase = voicemail ? 'voicemail' : 'ended';
        },
        onError: message => console.warn('[rehearsal]', message)
      }) as VoiceConversation;
      if (phase === 'connecting') phase = 'live';
      else await conversation.endSession().catch(() => {});
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      await stop(error instanceof ApiError && error.status === 503 ? 'unconfigured' : denied ? 'mic_denied' : 'error');
    }
  }

  onMount(async () => {
    try {
      const status = await request<{ ready: boolean }>('/api/rehearsal', { cache: 'no-store' });
      phase = status.ready ? 'ready' : 'unconfigured';
    } catch { phase = 'error'; }
  });
  onDestroy(() => { void stop('ended'); });

  const idle = $derived(phase === 'ready' || phase === 'connecting');
  const finished = $derived(phase === 'taken_over' || phase === 'voicemail' || phase === 'ended');
</script>

<svelte:head><title>{t('rehearsalTitle')} · {t('brand')}</title></svelte:head>
<div class="space-y-6">
  <section class="flex flex-col items-center rounded-2xl border border-surface-container bg-white p-5 text-center shadow-paper" aria-live="polite">
    <span class="mb-5 flex size-20 items-center justify-center rounded-full {phase === 'error' || phase === 'mic_denied' || phase === 'unconfigured' ? 'bg-error text-white' : humanAnswered || phase === 'taken_over' ? 'bg-secondary text-white' : 'bg-primary text-white'}" class:animate-pulse={phase === 'live' && speaking}>
      <Icon name={phase === 'error' || phase === 'mic_denied' || phase === 'unconfigured' ? 'warning' : phase === 'taken_over' ? 'user' : phase === 'voicemail' ? 'voicemail' : finished ? 'check' : 'headset'} size={36} />
    </span>
    <p class="eyebrow mb-3 text-outline">{t('rehearsalTitle')}</p>
    {#if phase === 'loading'}
      <p role="status" class="text-body-md text-outline">{t('loading')}</p>
    {:else if phase === 'unconfigured'}
      <p role="alert" class="max-w-md text-body-md text-error">{t('rehearsalNotConfigured')}</p>
    {:else if idle}
      <p class="max-w-md text-body-md text-on-surface-variant">{t('rehearsalIntro')}</p>
      <Button class="mt-6 w-full max-w-sm" onclick={start} disabled={phase === 'connecting'}><Icon name="headset" />{t(phase === 'connecting' ? 'rehearsalStarting' : 'rehearsalStart')}</Button>
    {:else if phase === 'live'}
      <h1 class="font-headline text-headline-lg-mobile text-primary sm:text-headline-lg">{t(humanAnswered ? 'rehearsalTakeOverHint' : speaking ? 'rehearsalSpeaking' : 'rehearsalListening')}</h1>
      <Button class="mt-6 w-full max-w-sm" variant={humanAnswered ? 'primary' : 'secondary'} onclick={() => stop('taken_over')}><Icon name="user" />{t('rehearsalTakeOver')}</Button>
      <Button variant="quiet" class="mt-3 w-full max-w-sm" onclick={() => stop('ended')}><Icon name="close" />{t('rehearsalStop')}</Button>
    {:else if finished}
      <h1 class="font-headline text-headline-lg-mobile text-primary sm:text-headline-lg">{t(phase === 'taken_over' ? 'rehearsalTakenOver' : 'rehearsalEnded')}</h1>
      <p class="mt-3 max-w-md text-body-md text-on-surface-variant">{t(phase === 'taken_over' ? 'rehearsalTakenOverHint' : phase === 'voicemail' ? 'rehearsalVoicemailEnded' : 'rehearsalEndedHint')}</p>
      <Button variant="quiet" class="mt-6 w-full max-w-sm" onclick={start}>{t('rehearsalAgain')}</Button>
    {:else}
      <p role="alert" class="max-w-md text-body-md text-error">{t(phase === 'mic_denied' ? 'rehearsalMicDenied' : 'rehearsalError')}</p>
      <Button variant="quiet" class="mt-6" onclick={start}>{t('retry')}</Button>
    {/if}
  </section>

  <p class="flex items-start gap-2 text-body-sm text-on-surface-variant"><Icon name="info" size={17} class="shrink-0 text-secondary" />{t('rehearsalBoundary')}</p>

  {#if phase !== 'loading' && phase !== 'unconfigured'}
    <Card class="space-y-3">
      <h2 class="eyebrow text-on-surface-variant">{t('rehearsalProgress')}</h2>
      <ol class="space-y-3" aria-label={t('rehearsalProgress')}>
        {#each shown as state (state)}
          {@const step = stepFor(state)}
          <li class="flex items-start gap-3" data-state={state} data-reached={step ? 'true' : 'false'}>
            <span class="flex size-7 shrink-0 items-center justify-center rounded-full {step ? (state === 'voicemail' ? 'bg-error-container text-error' : 'bg-secondary-container text-secondary') : 'bg-surface-container text-outline'}"><Icon name={step ? (state === 'voicemail' ? 'voicemail' : 'check') : 'clock'} size={16} /></span>
            <div class="min-w-0 flex-1">
              <p class="text-label-lg {step ? 'text-primary' : 'text-outline'}">{t(`rehearsal_${state}` as TranslationKey)}</p>
              <p class="mt-0.5 text-body-sm text-on-surface-variant">{step ? step.note ?? '' : t('rehearsalPending')}</p>
            </div>
            {#if step}<time datetime={step.at} class="shrink-0 pt-1 text-label-sm tabular-nums text-outline">{time(step.at)}</time>{/if}
          </li>
        {/each}
      </ol>
    </Card>

    {#if lines.length}
      <Card class="space-y-2">
        <h2 class="eyebrow text-on-surface-variant">{t('rehearsalTranscript')}</h2>
        <ul class="space-y-2" lang="de">
          {#each lines as line, index (index)}
            <li class="text-body-sm"><span class="font-semibold {line.role === 'agent' ? 'text-secondary' : 'text-primary'}">{t(line.role === 'agent' ? 'rehearsalAgent' : 'rehearsalHotline')}:</span> <span class="text-on-surface-variant">{line.text}</span></li>
          {/each}
        </ul>
      </Card>
    {/if}

    <Card class="space-y-3">
      <h2 class="eyebrow text-on-surface-variant">{t('rehearsalScript')}</h2>
      <ol class="space-y-3">
        {#each SCRIPT as line, index}
          <li class="flex items-start gap-2">
            <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] text-white">{index + 1}</span>
            <div class="min-w-0">
              <p class="text-label-md text-outline">{t(line.label)}</p>
              <p class="text-body-md text-primary" lang="de">„{line.text}“</p>
              {#if 'pause' in line}<p class="text-body-sm text-on-surface-variant">{t('rehearsalPause')}</p>{/if}
            </div>
          </li>
        {/each}
      </ol>
    </Card>
  {/if}
</div>
