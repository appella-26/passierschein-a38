<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { page } from '$app/state';
  import { language, t } from '#lib/i18n.ts';
  import { getDocument, request } from '#lib/api.ts';
  import { validChatId } from '#lib/assistant-client.ts';
  import { clearChat, getChatThread, sendChat, stopChat, undoChatChange, type ChatAction, type ChatChange, type ChatThread } from '#lib/chat-session.svelte.ts';
  import type { ActionItem, DocumentDetail } from '#lib/types.ts';
  import ChatText from '#lib/components/ChatText.svelte';
  import CasePreview from '#lib/components/CasePreview.svelte';
  import CallConfirm from '#lib/components/CallConfirm.svelte';
  import Icon from '#lib/components/Icon.svelte';

  const demo = $derived(import.meta.env.DEV && page.url.searchParams.get('demo') === '1');
  let thread = $state<ChatThread | null>(null);
  let contextTitle = $state('');
  let contextLoading = $state(false);
  let contextFailed = $state(false);
  let contextLetterId = $state<string | null>(null);
  let input = $state<HTMLTextAreaElement | null>(null);
  let composer = $state<HTMLDivElement | null>(null);
  let composerHeight = $state(100);
  let keyboardInset = $state(0);
  let keyboardOpen = $state(false);
  let followBottom = true;
  let lastFollowScrollY = 0;
  let previewCaseId = $state('');
  let previewOpen = $state(false);
  let previewRevision = $state(0);
  let confirmOpen = $state(false);
  let callDoc = $state<DocumentDetail | null>(null);
  let callAction = $state<ActionItem | null>(null);
  let actionLoading = $state(false);
  let actionController: AbortController | undefined;
  const messageLimit = $derived(contextLetterId ? 4000 - `[Selected letter: ${contextLetterId}]\n`.length : 4000);

  $effect(() => {
    const isDemo = demo;
    const letterId = page.url.searchParams.get('letter');
    const requestedCase = page.url.searchParams.get('case_id');
    const lang = isDemo ? language.current : 'en';
    const abort = new AbortController();
    let active: ChatThread | null = null;
    thread = null; contextTitle = ''; contextLetterId = null; contextFailed = false; contextLoading = true;
    followBottom = true; lastFollowScrollY = 0;
    previewOpen = false; confirmOpen = false; callDoc = null; callAction = null;
    actionController?.abort(); actionLoading = false;
    (async () => {
      try {
        if ((letterId && !validChatId(letterId)) || (requestedCase && !validChatId(requestedCase))) throw new Error('Invalid chat context');
        let caseId = requestedCase;
        if (letterId) {
          const doc = isDemo ? (await import('#lib/mock/data.ts')).getMockDocuments(lang).find(item => item.id === letterId) : await getDocument(letterId, abort.signal);
          if (!doc) throw new Error('Unknown letter');
          if (abort.signal.aborted) return;
          contextTitle = doc.document_type; contextLetterId = doc.id;
          caseId = isDemo ? ['demo-tax', 'demo-prior'].includes(doc.id) ? 'demo-case' : `demo-case-${doc.id}` : doc.case_id;
        } else if (caseId) {
          if (isDemo) {
            const docs = (await import('#lib/mock/data.ts')).getMockDocuments(lang);
            const doc = docs.find(item => caseId === 'demo-case' ? item.id === 'demo-tax' : caseId === `demo-case-${item.id}`);
            if (!doc) throw new Error('Unknown case');
            if (!abort.signal.aborted) contextTitle = doc.analysis.case_title;
          } else {
            const result = await request<{ title: string }>(`/api/cases/${encodeURIComponent(caseId)}`, { signal: abort.signal, cache: 'no-store' });
            if (!abort.signal.aborted) contextTitle = result.title;
          }
        }
        if (!abort.signal.aborted) { active = untrack(() => getChatThread(isDemo, caseId)); thread = active; }
      } catch { if (!abort.signal.aborted) contextFailed = true; }
      finally { if (!abort.signal.aborted) contextLoading = false; }
    })();
    return () => { abort.abort(); if (active) stopChat(active); };
  });

  function showCase(id: string) { previewCaseId = id; previewOpen = true; }
  function actionCited(action: ChatAction, content: string) {
    return action.event.action === 'open_letter' ? content.includes(`[[letter:${action.event.letter_id}]]`)
      : action.event.action === 'open_case' ? content.includes(`[[case:${action.event.case_id}]]`) : false;
  }
  function submit(value = thread?.draft ?? '') {
    if (!thread || contextLoading || contextFailed || thread.pending || thread.undoing) return;
    followBottom = true;
    lastFollowScrollY = window.scrollY;
    void sendChat(thread, value, language.current, contextLetterId);
  }
  async function undoChange(change: ChatChange) {
    if (!thread) return;
    await undoChatChange(thread, change, language.current);
    previewRevision++;
  }
  async function reviewCall(action: ChatAction) {
    if (action.event.action !== 'prepare_call' || actionLoading) return;
    const draft = action.event.call;
    const abort = new AbortController();
    actionController?.abort(); actionController = abort;
    actionLoading = true; action.failed = false;
    try {
      const doc = demo ? (await import('#lib/mock/data.ts')).getMockDocuments(language.current).find(item => item.id === draft.letter_id) : await getDocument(draft.letter_id, abort.signal);
      if (!doc) throw new Error('Unknown call letter');
      if (abort.signal.aborted) return;
      callDoc = doc;
      callAction = { title: doc.document_type, type: 'call', due: null, details: '', done: false,
        phone: draft.toNumber, phone_raw: draft.phone_raw, call_purpose_de: draft.purpose };
      confirmOpen = true;
    } catch { if (!abort.signal.aborted) action.failed = true; }
    finally { if (!abort.signal.aborted) actionLoading = false; }
  }

  $effect(() => {
    const element = input;
    void thread?.draft;
    if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(128, Math.max(48, element.scrollHeight))}px`; }
  });
  $effect(() => {
    const last = thread?.messages.at(-1);
    void last?.content; void last?.status; void last?.changes.length; void thread?.activity;
    void composerHeight; void keyboardInset;
    if (last && untrack(() => followBottom)) void tick().then(() => {
      // Scroll events can arrive after a new token: re-check the actual position before moving it.
      if (!followBottom || window.scrollY < lastFollowScrollY - 2) { followBottom = false; return; }
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      lastFollowScrollY = window.scrollY;
    });
  });
  onMount(() => {
    let fullHeight = window.innerHeight;
    let fullWidth = window.innerWidth;
    const viewport = window.visualViewport;
    const updateKeyboard = () => {
      if (window.innerWidth !== fullWidth) { fullWidth = window.innerWidth; fullHeight = window.innerHeight; }
      const focused = document.activeElement === input;
      const gap = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      keyboardOpen = focused && !!viewport && (viewport.scale ?? 1) <= 1.01 && (gap > 150 || viewport.height < fullHeight * 0.75);
      keyboardInset = keyboardOpen ? gap : 0;
      if (keyboardOpen) document.documentElement.dataset.chatKeyboardOpen = 'true';
      else delete document.documentElement.dataset.chatKeyboardOpen;
    };
    const focus = () => queueMicrotask(updateKeyboard);
    const scroll = () => {
      followBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 160;
      if (followBottom) lastFollowScrollY = window.scrollY;
    };
    const observer = new ResizeObserver(() => { if (composer) composerHeight = composer.getBoundingClientRect().height; });
    if (composer) observer.observe(composer);
    viewport?.addEventListener('resize', updateKeyboard); viewport?.addEventListener('scroll', updateKeyboard);
    document.addEventListener('focusin', focus); document.addEventListener('focusout', focus);
    window.addEventListener('scroll', scroll, { passive: true });
    return () => {
      observer.disconnect(); viewport?.removeEventListener('resize', updateKeyboard); viewport?.removeEventListener('scroll', updateKeyboard);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', focus);
      window.removeEventListener('scroll', scroll); delete document.documentElement.dataset.chatKeyboardOpen;
    };
  });
  onDestroy(() => { actionController?.abort(); if (thread) stopChat(thread); });
</script>

<svelte:head><title>{t('chat')} · {t('brand')}</title></svelte:head>
<div class="mx-auto max-w-2xl" style:padding-bottom={`${composerHeight + keyboardInset}px`}>
  <div class="flex items-center justify-between gap-3">
    <h1 class="font-headline text-headline-lg-mobile text-primary md:text-headline-lg">{t('chat')}</h1>
    {#if thread?.messages.length}<button type="button" disabled={thread.pending || thread.undoing} class="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-label-md text-outline hover:bg-surface-container disabled:opacity-50" onclick={() => { if (thread) clearChat(thread); followBottom = true; lastFollowScrollY = 0; }}><Icon name="plus" size={17} />{t('chatNew')}</button>{/if}
  </div>
  {#if contextTitle}<div class="mt-3 flex items-start justify-between gap-2 rounded-xl bg-surface-container-low px-3 py-2 text-body-sm text-primary"><span class="min-w-0">{t('chatAbout')}: {contextTitle}</span><a href={'/assistant' + (demo ? '?demo=1' : '')} class="touch-icon -mr-2 -mt-1 text-outline" aria-label={t('chatAllLetters')}><Icon name="close" size={17} /></a></div>{/if}
  {#if contextLoading}<p role="status" class="mt-6 text-body-sm text-outline">{t('loading')}</p>
  {:else if contextFailed}<div class="mt-6 space-y-3"><p role="alert" class="text-body-sm text-error">{t('chatContextFailed')}</p><a href={'/assistant' + (demo ? '?demo=1' : '')} class="inline-flex min-h-11 items-center text-label-md text-secondary">{t('chatAllLetters')}</a></div>
  {:else if thread}
    {#if !thread.messages.length}<section class="flex min-h-[calc(100dvh-390px)] flex-col justify-center py-8"><h2 class="font-headline text-headline-md text-primary">{t('chatGreeting')}</h2><p class="mt-2 max-w-md text-body-md text-on-surface-variant">{t('chatIntro')}</p><div class="mt-5 flex flex-wrap gap-2">{#each [contextLetterId ? 'chatSuggestLetter' : 'chatSuggestDeadlines', 'chatSuggestConnections'] as suggestion}<button type="button" class="min-h-11 rounded-full border border-surface-container bg-white px-3 text-left text-label-md text-secondary hover:bg-surface-container-low" onclick={() => submit(t(suggestion as 'chatSuggestLetter'))}>{t(suggestion as 'chatSuggestLetter')}</button>{/each}</div></section>
    {:else}<div role="log" aria-label={t('chatConversation')} aria-live="polite" aria-relevant="additions" class="mt-6 space-y-5">
      {#each thread.messages as message (message.id)}
        <article class={message.role === 'user' ? 'ml-auto max-w-[90%] rounded-2xl bg-primary px-4 py-3 text-white' : 'mr-auto w-full rounded-2xl border border-surface-container bg-white p-4 text-on-surface shadow-paper'} aria-label={t(message.role === 'user' ? 'chatYou' : 'chatAssistant')}>
          {#if message.role === 'user'}<p class="whitespace-pre-wrap text-body-md">{message.content}</p>
          {:else}
            {#if message.content}<ChatText content={message.content} refs={thread.refs} {demo} oncase={showCase} />{/if}
            {#if message.status === 'pending'}<p role="status" class="mt-2 flex items-center gap-2 text-body-sm text-outline"><span class="size-1.5 animate-pulse rounded-full bg-secondary"></span>{t(thread.activity)}</p>{/if}
            {#each message.changes as change (change.eventId)}<div class="mt-3 rounded-xl bg-surface-container-low px-3 py-1"><div class="flex flex-wrap items-center justify-between gap-2"><p class="min-w-0 py-2 text-body-sm text-primary">{change.summary}</p>{#if change.status === 'undone'}<span role="status" class="inline-flex items-center gap-1 text-label-md text-outline"><Icon name="check" size={15} />{t('chatUndone')}</span>{:else}<button type="button" disabled={thread.pending || thread.undoing} onclick={() => undoChange(change)} class="min-h-11 rounded-lg px-2 text-label-md text-secondary disabled:opacity-50">{t(change.status === 'undoing' ? 'todoSaving' : 'undo')}</button>{/if}</div>{#if change.status === 'failed'}<p role="alert" class="pb-2 text-body-sm text-error">{t('chatUndoFailed')}</p>{/if}</div>{/each}
            {#each message.actions as action, index (index)}{#if !actionCited(action, message.content)}<div class="mt-3">{#if action.event.action === 'open_letter'}<a href={`/letters/${encodeURIComponent(action.event.letter_id)}${demo ? '?demo=1' : ''}`} class="inline-flex min-h-11 items-center gap-2 text-label-md text-secondary"><Icon name="document" size={17} />{thread.refs.letters[action.event.letter_id]?.title ?? t('chatOpenLetter')}</a>{:else if action.event.action === 'open_case'}<button type="button" onclick={() => { if (action.event.action === 'open_case') showCase(action.event.case_id); }} class="inline-flex min-h-11 items-center gap-2 text-label-md text-secondary"><Icon name="folder" size={17} />{thread.refs.cases[action.event.case_id]?.title ?? t('chatOpenCase')}</button>{:else}<button type="button" disabled={thread.pending || actionLoading} onclick={() => reviewCall(action)} class="inline-flex min-h-11 items-center gap-2 text-label-md text-secondary disabled:opacity-50"><Icon name="phone" size={17} />{t('chatReviewCall')}</button>{/if}{#if action.failed}<p role="alert" class="text-body-sm text-error">{t('chatActionFailed')}</p>{/if}</div>{/if}{/each}
            {#if message.toolFailed}<p role="status" class="mt-3 text-body-sm text-outline">{t('chatToolFailed')}</p>{/if}
            {#if message.status === 'failed'}<p role="alert" class="mt-3 text-body-sm text-error">{t('chatReplyFailed')}</p>{:else if message.status === 'stopped'}<p role="status" class="mt-3 text-body-sm text-outline">{t('chatStopped')}</p>{/if}
          {/if}
        </article>
      {/each}
    </div>{/if}
  {/if}
</div>

<div bind:this={composer} class="fixed inset-x-0 z-20 border-t border-surface-container bg-surface" style:bottom={keyboardOpen ? `${keyboardInset}px` : 'var(--bottom-nav-height)'}>
  <div class="shell-container"><div class="mx-auto max-w-2xl py-3">
    <form class="flex items-end gap-2" onsubmit={event => { event.preventDefault(); submit(); }}>
      <label class="sr-only" for="chat-message">{t('chatInput')}</label>
      {#if thread}<textarea id="chat-message" bind:this={input} bind:value={thread.draft} rows="1" maxlength={messageLimit} class="paper-input min-w-0 flex-1 resize-none" placeholder={t('chatPlaceholder')} disabled={contextLoading || contextFailed || thread.undoing} onkeydown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); } }}></textarea>{:else}<textarea id="chat-message" rows="1" class="paper-input min-w-0 flex-1 resize-none" placeholder={t('chatPlaceholder')} disabled></textarea>{/if}
      {#if thread?.pending}<button type="button" class="touch-icon mb-0.5 bg-primary text-white" aria-label={t('chatStop')} onclick={() => { if (thread) stopChat(thread); }}><Icon name="close" size={20} /></button>{:else}<button type="submit" class="touch-icon mb-0.5 bg-primary text-white disabled:opacity-40" disabled={!thread?.draft.trim() || contextLoading || contextFailed || thread?.undoing} aria-label={t('chatSend')}><Icon name="arrow" size={20} /></button>{/if}
    </form>
    <details class="mt-1 text-[11px] leading-5 text-outline"><summary class="inline-flex cursor-pointer items-center gap-1.5 py-1"><Icon name="lock" size={12} />{t('chatInfo')}</summary><p class="max-w-prose py-2">{t('chatPrivacy')}</p></details>
  </div></div>
</div>
{#if previewCaseId}<CasePreview bind:open={previewOpen} caseId={previewCaseId} {demo} revision={previewRevision} />{/if}
{#if callDoc && callAction}<CallConfirm bind:open={confirmOpen} doc={callDoc} action={callAction} {demo} />{/if}

<style>
  :global(html[data-chat-keyboard-open='true'] .app-bottom-nav) { visibility: hidden; }
</style>
