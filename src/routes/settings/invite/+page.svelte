<script lang="ts">
	import InviteCard from '$lib/components/referrals/invite-card.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
</script>

<svelte:head>
	<title>Позвать друга — Flux Planner</title>
</svelte:head>

<PageHeader title="Позвать друга" subtitle="Ссылка-приглашение" back="/settings" />

<div class="flex flex-col gap-4">
	<InviteCard step={0} />
</div>
