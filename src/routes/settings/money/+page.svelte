<script lang="ts">
	import { Check } from 'phosphor-svelte';
	import { commitInteger } from '$lib/components/settings/commit';
	import SettingsField from '$lib/components/settings/settings-field.svelte';
	import SettingsGroup from '$lib/components/settings/settings-group.svelte';
	import SettingsRow from '$lib/components/settings/settings-row.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { formatNumber } from '$lib/utils/format';

	const settings = $derived(plannerStore.doc.settings);

	/**
	 * Лимит пишется и в настройки, и в сегодняшнюю запись: у дня с уже
	 * заведённой записью правка одного шаблона на экране бы не отразилась.
	 */
	function setBudget(value: number) {
		plannerStore.updateSettings({ dailyBudget: value });
		plannerStore.setDailyBudget(value);
	}

	/**
	 * Валюта — списком строк с галочкой, а не чипами: названия
	 * понятнее трёхбуквенных кодов, а строка — крупная мишень.
	 */
	const CURRENCIES = [
		{ code: 'RUB', title: 'Российский рубль' },
		{ code: 'USD', title: 'Доллар США' },
		{ code: 'EUR', title: 'Евро' },
		{ code: 'KZT', title: 'Казахстанский тенге' },
		{ code: 'BYN', title: 'Белорусский рубль' },
		{ code: 'UAH', title: 'Украинская гривна' }
	];

	function pickCurrency(code: string) {
		if (settings.currency === code) return;
		telegram.haptic.selection();
		plannerStore.updateSettings({ currency: code });
	}
</script>

<svelte:head>
	<title>Деньги — Flux Planner</title>
</svelte:head>

<PageHeader title="Деньги" subtitle="Лимит трат и валюта" back="/settings" />

<div class="flex flex-col gap-4">
	<SettingsGroup
		tone="sky"
		step={0}
		footer="Сколько можно потратить за день — от этой суммы главная считает остаток."
	>
		<SettingsField
			id="goal-budget"
			label="Лимит на день"
			value={formatNumber(plannerStore.todayFinance.budget)}
			unit={settings.currency}
			oncommit={(raw) => commitInteger(raw, setBudget)}
		/>
	</SettingsGroup>

	<SettingsGroup title="Валюта" tone="sky" step={1}>
		<div role="radiogroup" aria-label="Валюта">
			{#each CURRENCIES as currency (currency.code)}
				{@const selected = settings.currency === currency.code}
				{#snippet mark()}
					<span class="tabular w-9 text-right text-xs text-muted-foreground">{currency.code}</span>
					<span class="grid size-5 shrink-0 place-items-center">
						{#if selected}
							<Check size={16} weight="bold" class="text-tone" />
						{/if}
					</span>
				{/snippet}
				<SettingsRow
					label={currency.title}
					role="radio"
					aria-checked={selected}
					onclick={() => pickCurrency(currency.code)}
					trailing={mark}
				/>
			{/each}
		</div>
	</SettingsGroup>
</div>
