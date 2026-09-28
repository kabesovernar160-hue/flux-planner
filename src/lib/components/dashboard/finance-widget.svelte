<script lang="ts">
	import {
		ArrowDown,
		Bus,
		CaretDown,
		CaretRight,
		ForkKnife,
		Plus,
		Repeat,
		Wallet
	} from 'phosphor-svelte';
	import type { Component } from 'svelte';
	import { slide } from 'svelte/transition';
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
		{ id: 'subscriptions', title: 'Подписки', icon: Repeat }
	];

	const budget = $derived(plannerStore.todayFinance.budget);
	const currency = $derived(plannerStore.doc.settings.currency);
	const locale = $derived(plannerStore.doc.settings.locale);

	const money = (value: number) => formatMoney(value, currency, locale);

	/**
	 * Подробности по нажатию.
	 *
	 * Сумма дня уже крупно стоит в плитке сверху, поэтому карточка —
	 * это остаток и кнопка записи. Категории и доход нужны реже и
	 * раскрываются на месте, не уводя с главной.
	 */
	let expanded = $state(false);

	let revealed = $state(false);
	$effect(() => {
		const id = requestAnimationFrame(() => (revealed = true));
		return () => cancelAnimationFrame(id);
	});

	function addExpense() {
		telegram.haptic.impact('light');
		ui.openFinanceSheet(undefined, 'expense');
	}

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

	function toggleDetails() {
		telegram.haptic.selection();
		expanded = !expanded;
	}
</script>

<GlassCard tone="sky" id="finance-card">
	<a href="/calendar" class="flex items-center gap-2">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<Wallet size={15} weight="regular" class="text-tone" />
		</span>
		<h2 class="flex-1 text-sm font-medium">Финансы</h2>
		<CaretRight size={14} weight="light" class="text-muted-foreground" />
	</a>

	<div class="mt-3 flex items-end justify-between gap-4">
		<div class="min-w-0 flex-1">
			<p class="tabular text-sm font-medium {plannerStore.isOverBudget ? 'text-destructive' : ''}">
				{#if plannerStore.isOverBudget}
					Превышение на {money(-plannerStore.dailyBudgetRemaining)}
				{:else}
					Осталось {money(plannerStore.dailyBudgetRemaining)}
				{/if}
			</p>
			<p class="tabular mt-0.5 text-xs text-muted-foreground">из {money(budget)} на день</p>

			<div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line">
				<!-- Полоса обрезается на 100%, хотя сама доля может быть больше единицы. -->
				<div
					class="h-full origin-left rounded-full {plannerStore.isOverBudget
						? 'bg-destructive'
						: 'bg-tone'}"
					style="
						transform: scaleX({revealed ? Math.min(1, plannerStore.dailyBudgetProgress) : 0});
						transition: transform 0.5s var(--fx-ease);
					"
				></div>
			</div>
		</div>
		<SparkBars values={getSpendingSeries()} limit={budget} height={40} width={96} />
	</div>

	<!--
		Доход не прячется в подробности: если за день что-то пришло, это видно
		сразу. Иначе запись дохода выглядит так, будто она не сохранилась.
	-->
	{#if plannerStore.dailyIncome > 0}
		<p class="tabular mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
			<ArrowDown size={12} weight="bold" class="shrink-0 text-success" />
			<span class="text-success">+{money(plannerStore.dailyIncome)}</span>
			· баланс дня {plannerStore.dailyBalance >= 0 ? '+' : '−'}{money(
				Math.abs(plannerStore.dailyBalance)
			)}
		</p>
	{/if}

	<div class="mt-4 flex items-center gap-2">
		<button
			type="button"
			onclick={addExpense}
			class="flex flex-1 items-center justify-center gap-2 rounded-full bg-tone py-2.5 text-xs
			       font-medium text-void shadow-[0_12px_32px_-16px_var(--fx-tone)]
			       transition-transform duration-500 ease-flux active:scale-[0.98]"
		>
			<Plus size={13} weight="bold" />
			Трата
		</button>
		<button
			type="button"
			onclick={addIncome}
			class="flex flex-1 items-center justify-center gap-2 rounded-full border border-line-strong
			       py-2.5 text-xs font-medium transition-[transform,border-color] duration-500 ease-flux
			       hover:border-success/60 active:scale-[0.98]"
		>
			<ArrowDown size={13} weight="bold" class="text-success" />
			Доход
		</button>
		<button
			type="button"
			onclick={toggleDetails}
			aria-expanded={expanded}
			aria-label={expanded ? 'Скрыть категории' : 'Траты по категориям'}
			class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
			       text-muted-foreground transition-transform duration-500 ease-flux active:scale-90"
		>
			<CaretDown
				size={14}
				weight="light"
				class="transition-transform duration-400 ease-flux {expanded ? 'rotate-180' : ''}"
			/>
		</button>
	</div>

	{#if expanded}
		<!-- Пилюли, а не сетка: ряд не растягивается в решётку 3×1 и остаётся компактным. -->
		<div transition:slide={{ duration: 300 }} class="-mx-1 flex gap-2 overflow-x-auto px-1 pt-3">
			{#each QUICK as category (category.id)}
				{@const Icon = category.icon}
				{@const amount = plannerStore.expensesByCategory[category.id] ?? 0}
				<button
					type="button"
					onclick={() => pickCategory(category.id)}
					aria-label="{category.title}: потрачено {money(amount)}"
					class="flex shrink-0 items-center gap-1.5 rounded-full border border-line/70 bg-white/[0.02]
					       py-2 pr-3.5 pl-2.5 transition-[transform,border-color] duration-500 ease-flux
					       hover:border-line-strong active:scale-[0.97]"
				>
					<Icon size={15} weight="light" class="shrink-0 text-tone" />
					<span class="text-[11px] text-muted-foreground">{category.title}</span>
					<span class="tabular text-xs font-medium">{money(amount)}</span>
				</button>
			{/each}
		</div>
	{/if}
</GlassCard>
