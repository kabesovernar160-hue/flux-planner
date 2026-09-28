<script lang="ts">
	import SubscriptionCard from '$lib/components/billing/subscription-card.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
</script>

<svelte:head>
	<title>Тариф — Flux Planner</title>
</svelte:head>

<PageHeader title="Тариф" subtitle="Оплата звёздами Telegram" back="/settings" />

<div class="flex flex-col gap-4">
	<SubscriptionCard step={0} />
</div>
