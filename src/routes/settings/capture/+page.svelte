<script lang="ts">
	import CaptureCard from '$lib/components/capture/capture-card.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
</script>

<svelte:head>
	<title>Запись без Telegram — Flux Planner</title>
</svelte:head>

<PageHeader title="Запись без Telegram" subtitle="Быстрая команда на айфоне" back="/settings" />

<div class="flex flex-col gap-4">
	<CaptureCard step={0} />
</div>
