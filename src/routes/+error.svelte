<script lang="ts">
  import { page } from '$app/state';
  import { t } from '#lib/i18n.ts';
  import Card from '#lib/components/Card.svelte';
</script>

<Card class="space-y-4 text-center"><h1 class="font-headline text-headline-lg-mobile text-primary">{t(page.status === 404 ? 'notFound' : 'errorTitle')}</h1><p class="text-body-md text-on-surface-variant">{t('error')}</p><a href="/" class="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-label-lg text-white">{t('overview')}</a></Card>
