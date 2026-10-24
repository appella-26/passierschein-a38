<script lang="ts">
  import { goto } from '$app/navigation';
  import type { ActionItem, DocumentDetail, CallState } from '#lib/types.ts';
  import { t } from '#lib/i18n.ts';
  import { ApiError, post } from '#lib/api.ts';
  import { phoneToE164 } from '#lib/format.ts';
  import { saveCallContext } from '#lib/call-session.svelte.ts';
  import { enableSound } from '#lib/notifications.svelte.ts';
  import BottomSheet from './BottomSheet.svelte';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';
  let { open = $bindable(false), doc, action, demo = false }: { open?: boolean; doc: DocumentDetail; action: ActionItem; demo?: boolean } = $props();
  let number = $state('');
  let purpose = $state('');
  let consent = $state(false);
  let pending = $state(false);
  let failed = $state<'error' | 'callNotConfigured' | false>(false);
  const normalized = $derived(phoneToE164(number));
  const reference = $derived(doc.analysis.references.map(item => `${item.label}: ${item.value}`).join(' · '));
  $effect(() => { if (open) { number = action.phone_raw ?? action.phone ?? ''; purpose = action.call_purpose_de ?? ''; consent = false; failed = false; } });

  async function start() {
    if (!normalized || !purpose.trim() || !consent || pending) return;
    pending = true;
    failed = false;
    void enableSound();
    const input = { toNumber: normalized, senderName: doc.analysis.sender.name, purpose: purpose.trim(), reference, letterDate: doc.analysis.letter_date ?? undefined };
    try {
      const result = demo ? { id: 'demo-call', state: 'dialing' as CallState } : await post<{ id: string; state: CallState }>('/api/calls', input);
      saveCallContext({ id: result.id, ...input, letterId: doc.id, demo });
      open = false;
      await goto(`/calls/${encodeURIComponent(result.id)}${demo ? '?demo=1' : ''}`);
    } catch (error) { failed = error instanceof ApiError && error.status === 503 ? 'callNotConfigured' : 'error'; }
    finally { pending = false; }
  }
</script>

<BottomSheet bind:open title={t('prepareCall')}>
  <form onsubmit={(event) => { event.preventDefault(); void start(); }} class="space-y-4">
    <Card class="flex items-center gap-3 !p-3">
      <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container text-primary"><Icon name="bank" /></span>
      <div class="min-w-0"><p class="eyebrow text-outline">{t('recipient')}</p><p class="text-label-lg text-primary">{doc.analysis.sender.name}</p></div>
    </Card>
    <Card class="space-y-2"><label for="call-number" class="eyebrow block text-on-surface-variant">{t('phone')}</label><p class="text-[11px] leading-5 text-outline">{t('detectedNumber')}</p><input id="call-number" type="tel" bind:value={number} class="paper-input font-mono" autocomplete="tel" required aria-invalid={!normalized && !!number} aria-describedby="number-help" /><p id="number-help" class="text-body-sm {normalized ? 'text-secondary' : 'text-error'}">{normalized ? t('normalizedNumber', { number: normalized }) : t('invalidNumber')}</p></Card>
    <Card class="space-y-2">
      <label for="call-purpose" class="eyebrow block text-on-surface-variant">{t('purposeLabel')}</label>
      <p id="purpose-help" class="text-[12px] leading-5 text-outline">{t('purposeHint')}</p>
      <textarea id="call-purpose" lang="de" class="paper-input min-h-24 leading-6" bind:value={purpose} required maxlength="500" aria-describedby="purpose-help"></textarea>
    </Card>
    <Card class="space-y-3">
      <h3 class="eyebrow text-on-surface-variant">{t('transmittedReference')}</h3>
      <dl class="space-y-3 rounded-lg bg-surface-container-low p-3">
        {#each doc.analysis.references as item, index (index)}
          <div class="min-w-0"><dt class="text-label-md text-on-surface-variant">{item.label}</dt><dd class="data-value mt-1 select-all font-mono text-body-sm text-primary">{item.value}</dd></div>
        {:else}<dd class="text-body-sm text-outline">{t('noReference')}</dd>{/each}
      </dl>
    </Card>
    <div class="rounded-xl border border-primary/10 bg-primary/5 p-4"><h3 class="mb-3 flex items-center gap-2 text-label-lg text-primary"><Icon name="info" size={18} />{t('howCallWorks')}</h3><ol class="space-y-2.5">{#each ['callStep1', 'callStep2', 'callStep3'] as step, index}<li class="flex items-start gap-2 text-body-sm text-on-surface-variant"><span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] text-white">{index + 1}</span>{t(step as 'callStep1')}</li>{/each}</ol></div>
    <p class="flex items-start gap-2 text-body-sm text-on-surface-variant"><Icon name="lock" size={17} class="shrink-0 text-secondary" />{t('callPrivacy')}</p>
    <label class="flex min-h-12 items-start gap-3 rounded-xl bg-surface-container-low p-3 text-body-sm text-primary"><input class="mt-1 size-5 shrink-0 accent-primary" type="checkbox" bind:checked={consent} required />{t('confirmConsent')}</label>
    {#if failed}<p role="alert" class="rounded-xl bg-error-container p-3 text-body-sm text-error">{t(failed)}</p>{/if}
    <Button type="submit" class="w-full" disabled={pending || !normalized || !purpose.trim() || !consent}><Icon name="phone" />{t(pending ? 'startingCall' : 'startCall')}</Button>
    <Button variant="quiet" class="w-full" onclick={() => open = false} disabled={pending}>{t('backToLetter')}</Button>
  </form>
</BottomSheet>
