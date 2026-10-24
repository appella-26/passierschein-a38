<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ActionItem, DocumentDetail } from '#lib/types.ts';
  import { formatDate } from '#lib/format.ts';
  import { t } from '#lib/i18n.ts';
  import { setDemoCompleted } from '#lib/checklist.svelte.ts';
  import { getDocument, post, request } from '#lib/api.ts';
  import Card from './Card.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  let { doc, completed, demo = false, oncall, onupdate }: { doc: DocumentDetail; completed: number[]; demo?: boolean; oncall: (action: ActionItem) => void; onupdate: (doc: DocumentDetail) => void } = $props();
  let saving = $state(false);
  let failure = $state<'todoSaveFailed' | 'todoUndoFailed' | 'todoRefreshFailed' | null>(null);
  let lastChange = $state<{ eventId: number | null; index: number; before: boolean } | null>(null);
  let disposed = false;
  onDestroy(() => disposed = true);

  async function refresh(fallback: DocumentDetail) {
    try {
      const fresh = await getDocument(fallback.id);
      if (!disposed) onupdate(fresh);
    } catch {
      // The write succeeded. Keep its confirmed result, but flag that other details may be stale.
      if (!disposed) { onupdate(fallback); failure = 'todoRefreshFailed'; }
    }
  }
  function withDone(index: number, done: boolean): DocumentDetail {
    return { ...doc, analysis: { ...doc.analysis, action_items: doc.analysis.action_items.map((action, i) => i === index ? { ...action, done } : action) } };
  }
  async function save(index: number, done: boolean) {
    if (saving) return;
    const before = completed.includes(index);
    failure = null;
    if (demo) { setDemoCompleted(doc, index, done); lastChange = { eventId: null, index, before }; return; }
    saving = true;
    try {
      const change = await request<{ event_id: number }>(`/api/documents/${encodeURIComponent(doc.id)}/todos/${index}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done })
      });
      if (disposed) return;
      lastChange = { eventId: change.event_id, index, before };
      const confirmed = withDone(index, done);
      onupdate(confirmed);
      await refresh(confirmed);
    } catch { if (!disposed) failure = 'todoSaveFailed'; }
    finally { if (!disposed) saving = false; }
  }
  async function undo() {
    if (!lastChange || saving) return;
    const change = lastChange;
    failure = null;
    if (demo) { setDemoCompleted(doc, change.index, change.before); lastChange = null; return; }
    saving = true;
    try {
      await post(`/api/case-events/${change.eventId}/undo`);
      if (disposed) return;
      lastChange = null;
      // The server's inverse can differ from our old UI state if another client edited first.
      // Only a fresh read confirms the result of Undo; don't guess its checkmark.
      await refresh(doc);
    } catch { if (!disposed) failure = 'todoUndoFailed'; }
    finally { if (!disposed) saving = false; }
  }
  async function retryRefresh() {
    if (saving) return;
    failure = null; saving = true;
    await refresh(doc);
    if (!disposed) saving = false;
  }
</script>

<Card class="space-y-4">
  <div class="section-heading">
    <h2 class="flex items-center gap-2 font-headline text-headline-md text-primary"><Icon name="list" size={22} class="shrink-0" />{t('todos')}</h2>
    <span class="shrink-0 whitespace-nowrap rounded-full bg-secondary-container px-2.5 py-1 text-[11px] text-on-secondary-fixed-variant">{t('completed', { done: completed.length, total: doc.analysis.action_items.length })}</span>
  </div>
  <div class="space-y-3">
    {#each doc.analysis.action_items as action, index (index)}
      <div class="space-y-3 rounded-xl bg-surface-container-low p-3">
        <div class="flex items-start gap-2">
          <label class="-ml-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg">
            <input type="checkbox" class="size-6 rounded-md accent-secondary disabled:opacity-50" checked={completed.includes(index)} disabled={saving} onchange={event => { const done = event.currentTarget.checked; event.currentTarget.checked = completed.includes(index); void save(index, done); }} aria-label={t('completeAction', { title: action.title })} />
          </label>
          <h3 class="min-w-0 flex-1 pt-2.5 text-label-lg text-primary" class:line-through={completed.includes(index)} class:opacity-60={completed.includes(index)}>{action.title}</h3>
        </div>
        <p class="prose-copy whitespace-pre-line text-body-sm text-on-surface-variant">{action.details}</p>
        {#if action.due}<p class="text-[12px] text-outline">{t('deadlineLabel')}: <time datetime={action.due} class="whitespace-nowrap">{formatDate(action.due, true)}</time></p>{/if}
        {#if action.type === 'call'}
          <div class="space-y-3 rounded-lg border border-surface-container bg-white p-3">
            <div class="section-heading">
              <h4 class="flex items-center gap-1.5 text-label-md text-primary"><Icon name="headset" size={18} class="shrink-0 text-secondary" />{t('waitingPilot')}</h4>
              <span class="shrink-0 rounded-full bg-surface-container px-2 py-1 text-[10px] text-on-surface-variant">{t('automaticCall')}</span>
            </div>
            <p class="prose-copy text-body-sm text-on-surface-variant">{t('waitingHint')}</p>
            {#if action.phone}
              <p class="whitespace-nowrap font-mono text-body-sm text-primary">{action.phone_raw ?? action.phone}</p>
              <Button class="w-full" onclick={() => oncall(action)}><Icon name="headset" size={20} />{t('waitForMe')}</Button>
            {:else}<p class="text-body-sm text-outline">{t('missingPhone')}</p>{/if}
          </div>
        {/if}
      </div>
    {:else}<p class="text-body-sm text-on-surface-variant">{t('noActions')}</p>{/each}
  </div>
  {#if saving}<p role="status" class="text-body-sm text-outline">{t('todoSaving')}</p>{/if}
  {#if failure}<div class="space-y-2 rounded-xl bg-error-container p-3"><p role="alert" class="text-body-sm text-on-error-container">{t(failure)}</p><Button variant="quiet" disabled={saving} onclick={retryRefresh}>{t('reloadLetter')}</Button></div>{/if}
  {#if lastChange}<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-container-low px-3"><p role="status" class="text-body-sm text-primary">{t('todoSaved')}</p><Button variant="quiet" disabled={saving} onclick={undo}>{t('undo')}</Button></div>{/if}
  <p class="text-[12px] leading-5 text-outline">{t(demo ? 'demoChecklist' : 'savedChecklist')}</p>
</Card>
