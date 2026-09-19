<script lang="ts">
	import {
		ArrowDown,
		ArrowUp,
		Bus,
		CaretRight,
		DeviceMobile,
		ForkKnife,
		Wallet
	} from 'phosphor-svelte';
	import type { Component } from 'svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import SparkBars from '$lib/components/ui/spark-bars.svelte';
	import { getSpendingSeries } from '$lib/services/financeService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import type { FinanceCategory } from '$lib/types/finance';
	import { formatMoney } from '$lib/utils/format';

	/**
	 * Быстрые категории на дашборде. Это витрина трёх самых частых категорий
	 * из общего списка, а не отдельная сущность: суммы берутся из обычных
	 * FinanceEntry, сгруппированных стором.
	 */
	const QUICK: { id: FinanceCategory; title: string; icon: Component }[] = [
		{ id: 'food', title: 'Еда', icon: ForkKnife },
		{ id: 'transport', title: 'Транспорт', icon: Bus },
		{ id: 'subscriptions', title: 'Связь', icon: DeviceMobile }
	];

	const budget = $derived(plannerStore.todayFinance.budget);
	const currency = $derived(plannerStore.doc.settings.currency);
	const locale = $derived(plannerStore.doc.settings.locale);

	const money = (value: number) => formatMoney(value, currency, locale);

	let revealed = $state(false);
	$effect(() => {
		const id = requestAnimationFrame(() => (revealed = true));
		return () => cancelAnimationFrame(id);
	});

	// Быстрые кнопки открывают обычную форму с предвыбранной категорией.
	// Отдельной модели «быстрой траты» нет: это те же FinanceEntry.
	function pickCategory(id: FinanceCategory) {
		telegram.haptic.impact('light');
		ui.openFinanceSheet(id, 'expense');
	}

	function addIncome() {
		telegram.haptic.impact('light');
		ui.openFinanceSheet(undefined, 'income');
	}
</script>

<GlassCard>
	<div class="mb-3 flex items-center gap-2">
		<Wallet size={16} weight="light" class="text-lavender" />
		<h2 class="flex-1 text-sm font-medium">Финансы</h2>
		<a href="/calendar" aria-label="Открыть календарь">
			<CaretRight size={14} weight="light" class="text-muted-foreground" />
		</a>
	</div>

	<div class="flex items-end justify-between gap-4">
		<div class="min-w-0">
			<p class="tabular text-2xl leading-none font-semibold tracking-tight">
				{money(plannerStore.dailySpent)}
			</p>
			<p class="tabular mt-1.5 text-xs text-muted-foreground">лимит {money(budget)}</p>
		</div>
		<SparkBars values={getSpendingSeries()} limit={budget} />
	</div>

	<div class="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
		<!-- Полоса обрезается на 100%, хотя сама доля может быть больше единицы. -->
		<div
			class="h-full origin-left rounded-full {plannerStore.isOverBudget
				? 'bg-destructive'
				: 'bg-lavender'}"
			style="
				transform: scaleX({revealed ? Math.min(1, plannerStore.dailyBudgetProgress) : 0});
				transition: transform 0.9s var(--fx-ease);
			"
		></div>
	</div>

	<p
		class="tabular mt-2 text-xs {plannerStore.isOverBudget
			? 'text-destructive'
			: 'text-muted-foreground'}"
	>
		{#if plannerStore.isOverBudget}
			Превышение на {money(-plannerStore.dailyBudgetRemaining)}
		{:else}
			Осталось {money(plannerStore.dailyBudgetRemaining)}
		{/if}
	</p>

	<!--
		Доход не прячется в истории: если за день что-то пришло, это видно рядом
		с тратой. Иначе запись дохода выглядит так, будто она не сохранилась.
	-->
	{#if plannerStore.dailyIncome > 0}
		<div
			class="mt-3 flex items-center gap-2 rounded-xl border border-line/70 bg-white/[0.02] px-3 py-2.5"
		>
			<ArrowDown size={14} weight="bold" class="shrink-0 text-success" />
			<span class="min-w-0 flex-1 text-xs text-muted-foreground">Доход сегодня</span>
			<span class="tabular text-sm font-medium text-success"
				>+{money(plannerStore.dailyIncome)}</span
			>
		</div>
		<p class="tabular mt-1.5 text-xs text-muted-foreground">
			Баланс дня: {plannerStore.dailyBalance >= 0 ? '+' : '−'}{money(
				Math.abs(plannerStore.dailyBalance)
			)}
		</p>
	{/if}

	<div class="mt-4 grid grid-cols-3 gap-2">
		{#each QUICK as category (category.id)}
			{@const Icon = category.icon}
			{@const amount = plannerStore.expensesByCategory[category.id] ?? 0}
			<button
				type="button"
				onclick={() => pickCategory(category.id)}
				aria-label="{category.title}: потрачено {money(amount)}"
				class="flex flex-col items-center gap-1.5 rounded-xl border border-line/70 bg-white/[0.02]
				       px-2 py-3 transition-[transform,border-color] duration-500 ease-flux
				       hover:border-line-strong active:scale-[0.97]"
			>
				<Icon size={18} weight="light" class="text-lavender" />
				<span class="max-w-full truncate text-[11px] text-muted-foreground">{category.title}</span>
				<span class="tabular text-xs font-medium">{money(amount)}</span>
			</button>
		{/each}
	</div>

	<button
		type="button"
		onclick={addIncome}
		class="mt-2 flex w-full items-center justify-center gap-2 rounded-full border
		       border-line-strong py-2.5 text-xs font-medium transition-[transform,border-color]
		       duration-500 ease-flux hover:border-success/60 active:scale-[0.98]"
	>
		<ArrowUp size={13} weight="bold" class="text-success" />
		Записать доход
	</button>
</GlassCard>
