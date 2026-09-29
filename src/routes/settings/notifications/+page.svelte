<script lang="ts">
	import { ChatCircleText } from 'phosphor-svelte';
	import SettingsGroup from '$lib/components/settings/settings-group.svelte';
	import SettingsRow from '$lib/components/settings/settings-row.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';

	const settings = $derived(plannerStore.doc.settings);

	/** Отсутствие настройки означает «включено»: так было до появления переключателя. */
	const dailySummaryOn = $derived(settings.notifications?.dailySummary !== false);

	function toggleDailySummary() {
		telegram.haptic.selection();
		plannerStore.updateSettings({
			notifications: { ...settings.notifications, dailySummary: !dailySummaryOn }
		});
	}
</script>

<svelte:head>
	<title>Уведомления — Flux Planner</title>
</svelte:head>

<PageHeader title="Уведомления" subtitle="Сообщения бота в чате Telegram" back="/settings" />

{#snippet toggle()}
	<span
		aria-hidden="true"
		class="relative h-6 w-10 shrink-0 rounded-full transition-colors duration-300 ease-flux
		       {dailySummaryOn ? 'bg-tone' : 'bg-line'}"
	>
		<span
			class="absolute top-1 size-4 rounded-full bg-white transition-[left] duration-300 ease-flux
			       {dailySummaryOn ? 'left-5' : 'left-1'}"
		></span>
	</span>
{/snippet}

<div class="flex flex-col gap-4">
	<SettingsGroup
		tone="mint"
		step={0}
		footer={telegram.isEmbedded
			? undefined
			: 'Сообщения приходят в чат с ботом — настройка подействует, когда приложение открыто из Telegram.'}
	>
		<SettingsRow
			icon={ChatCircleText}
			tone="mint"
			label="Итоги дня в чате"
			hint="Вечером бот присылает калории, привычки и траты"
			role="switch"
			aria-checked={dailySummaryOn}
			onclick={toggleDailySummary}
			trailing={toggle}
		/>
	</SettingsGroup>
</div>
