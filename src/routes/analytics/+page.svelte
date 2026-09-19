<script lang="ts">
	import { CheckCircle, Fire, ForkKnife, Wallet } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import PeriodBars from '$lib/components/ui/period-bars.svelte';
	import { CATEGORY_LABELS } from '$lib/services/financeService';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import {
		average,
		averageMacros,
		averageOfActive,
		caloriesByDay,
		caloriesByMeal,
		expensesByCategory,
		habitRateByDay,
		incomeByDay,
		spendingByDay,
		totalOf
	} from '$lib/utils/analytics';
	import { formatMacro, formatMoney, formatNumber } from '$lib/utils/format';

	/** Неделя и месяц: две привычные рамки, между которыми есть смысл сравнивать. */
	const PERIODS = [
		{ days: 7, label: '7 дней' },
		{ days: 30, label: '30 дней' }
	];

	let days = $state(7);

	const end = $derived(plannerStore.currentDate);
	const currency = $derived(plannerStore.doc.settings.currency);
	const locale = $derived(plannerStore.doc.settings.locale);
	const money = (value: number) => formatMoney(value, currency, locale);

	const calories = $derived(caloriesByDay(plannerStore.foodEntries, end, days));
	const macros = $derived(averageMacros(plannerStore.foodEntries, end, days));
	const meals = $derived(
		caloriesByMeal(plannerStore.foodEntries, end, days, plannerStore.doc.user.timezone)
	);
	const spending = $derived(spendingByDay(plannerStore.financeEntries, end, days));
	const categories = $derived(expensesByCategory(plannerStore.financeEntries, end, days));
	const income = $derived(incomeByDay(plannerStore.financeEntries, end, days));
	const totalIncome = $derived(totalOf(income));
	const balance = $derived(totalIncome - totalOf(spending));
	const habitRate = $derived(
		habitRateByDay(plannerStore.habits, plannerStore.habitCompletions, end, days)
	);

	// Среднее считается по дням с записями: пропущенные дни изображали бы
	// дефицит, которого не было.
	const avgCalories = $derived(averageOfActive(calories));
	const trackedDays = $derived(calories.filter((day) => day.value > 0).length);

	const avgSpending = $derived(average(spending));
	const totalSpending = $derived(totalOf(spending));
	const habitPercent = $derived(Math.round(average(habitRate) * 100));

	const goal = $derived(plannerStore.todayNutrition.calorieGoal);
	const budget = $derived(plannerStore.todayFinance.budget);

	function pickPeriod(value: number) {
		telegram.haptic.selection();
		days = value;
	}
</script>

<PageHeader title="Аналитика" subtitle="Записей за период: {trackedDays}" />

<div class="mb-4 flex gap-1.5 rounded-full border border-line/70 bg-white/[0.02] p-1">
	{#each PERIODS as period (period.days)}
		<button
			type="button"
			onclick={() => pickPeriod(period.days)}
			aria-pressed={days === period.days}
			class="flex-1 rounded-full py-2 text-xs font-medium transition-colors duration-400 ease-flux
			       {days === period.days ? 'bg-lavender text-void' : 'text-muted-foreground'}"
		>
			{period.label}
		</button>
	{/each}
</div>

<div class="flex flex-col gap-4">
	<GlassCard>
		<div class="mb-3 flex items-center gap-2">
			<ForkKnife size={16} weight="light" class="text-lavender" />
			<h2 class="flex-1 text-sm font-medium">Калории</h2>
			<span class="tabular text-xs text-muted-foreground">цель {formatNumber(goal)}</span>
		</div>

		{#if trackedDays === 0}
			<p class="py-2 text-sm text-muted-foreground">
				За этот период записей нет. Добавьте еду — график появится здесь.
			</p>
		{:else}
			<p class="tabular text-3xl leading-none font-semibold tracking-tight">
				{formatNumber(Math.round(avgCalories))}
				<span class="text-sm font-normal text-muted-foreground">ккал в среднем</span>
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				Считается по дням с записями, их {trackedDays} из {days}.
			</p>

			<div class="mt-4">
				<PeriodBars values={calories} {goal} labels={days <= 7} warnOverGoal />
			</div>

			<div class="mt-4 grid grid-cols-3 gap-2">
				{#each [['Белки', macros.protein], ['Жиры', macros.fat], ['Углеводы', macros.carbs]] as [label, value] (label)}
					<div class="rounded-xl border border-line/70 bg-white/[0.02] px-2 py-2.5 text-center">
						<p class="text-[11px] text-muted-foreground">{label}</p>
						<p class="tabular mt-0.5 text-sm font-medium">{formatMacro(value as number)} г</p>
					</div>
				{/each}
			</div>
			<p class="mt-2 text-[11px] text-muted-foreground">Средние значения за день с записями.</p>

			{#if meals.length > 1}
				<!--
					Разбивка по приёмам отвечает на вопрос, который сумма за день
					не берёт: перебор набегает за ужином или его добирают перекусами.
				-->
				<div class="mt-4 border-t border-line/70 pt-3">
					<p class="mb-2 text-xs text-muted-foreground">Откуда калории</p>
					<ul class="flex flex-col gap-2">
						{#each meals as meal (meal.meal)}
							<li>
								<div class="mb-1 flex items-baseline gap-2">
									<span class="min-w-0 flex-1 truncate text-xs">{meal.label}</span>
									<span class="tabular text-xs text-muted-foreground">
										{Math.round(meal.share * 100)}%
									</span>
									<span class="tabular text-xs font-medium">
										{formatNumber(Math.round(meal.calories))} ккал
									</span>
								</div>
								<div class="h-1 overflow-hidden rounded-full bg-line">
									<div
										class="h-full rounded-full bg-lavender"
										style="width: {Math.round(meal.share * 100)}%"
									></div>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
	</GlassCard>

	<GlassCard>
		<div class="mb-3 flex items-center gap-2">
			<CheckCircle size={16} weight="light" class="text-lavender" />
			<h2 class="flex-1 text-sm font-medium">Привычки</h2>
			<span class="tabular text-xs text-muted-foreground">{habitPercent}%</span>
		</div>

		{#if plannerStore.habits.length === 0}
			<p class="py-2 text-sm text-muted-foreground">
				Привычек ещё нет. <a href="/habits" class="text-lavender">Добавить первую</a>.
			</p>
		{:else}
			<!-- Доли 0…1 приводятся к процентам для общей шкалы графика. -->
			<PeriodBars
				values={habitRate.map((day) => ({ date: day.date, value: day.value * 100 }))}
				goal={100}
				labels={days <= 7}
				height={90}
			/>

			<div class="mt-4 grid grid-cols-2 gap-2">
				<div class="flex items-center gap-2.5 rounded-xl border border-line/70 px-3 py-2.5">
					<Fire size={16} weight="fill" class="shrink-0 text-lavender" />
					<div class="min-w-0">
						<p class="text-[11px] text-muted-foreground">Сейчас</p>
						<p class="tabular text-sm font-medium">{plannerStore.currentStreak} дней</p>
					</div>
				</div>
				<div class="flex items-center gap-2.5 rounded-xl border border-line/70 px-3 py-2.5">
					<Fire size={16} weight="light" class="shrink-0 text-muted-foreground" />
					<div class="min-w-0">
						<p class="text-[11px] text-muted-foreground">Лучшая серия</p>
						<p class="tabular text-sm font-medium">{plannerStore.longestStreak} дней</p>
					</div>
				</div>
			</div>
		{/if}
	</GlassCard>

	<GlassCard>
		<div class="mb-3 flex items-center gap-2">
			<Wallet size={16} weight="light" class="text-lavender" />
			<h2 class="flex-1 text-sm font-medium">Траты</h2>
			<span class="tabular text-xs text-muted-foreground">лимит {money(budget)}</span>
		</div>

		{#if totalSpending === 0 && totalIncome === 0}
			<p class="py-2 text-sm text-muted-foreground">За этот период записей не было.</p>
		{:else}
			<p class="tabular text-3xl leading-none font-semibold tracking-tight">
				{money(totalSpending)}
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				В среднем {money(Math.round(avgSpending))} в день.
			</p>

			<div class="mt-4">
				<PeriodBars values={spending} goal={budget} labels={days <= 7} height={90} warnOverGoal />
			</div>

			{#if totalIncome > 0}
				<!--
					Доход и баланс рядом с тратами: без них «потрачено 40 000»
					не отвечает на вопрос, хорошо это или плохо.
				-->
				<div class="mt-4 grid grid-cols-2 gap-2">
					<div class="rounded-xl border border-line/70 bg-white/[0.02] px-3 py-2.5">
						<p class="text-[11px] text-muted-foreground">Доход</p>
						<p class="tabular mt-0.5 text-sm font-medium text-success">+{money(totalIncome)}</p>
					</div>
					<div class="rounded-xl border border-line/70 bg-white/[0.02] px-3 py-2.5">
						<p class="text-[11px] text-muted-foreground">Баланс</p>
						<p class="tabular mt-0.5 text-sm font-medium {balance < 0 ? 'text-destructive' : ''}">
							{balance >= 0 ? '+' : '−'}{money(Math.abs(balance))}
						</p>
					</div>
				</div>
			{/if}

			<ul class="mt-4 flex flex-col gap-2">
				{#each categories as category (category.category)}
					<li>
						<div class="mb-1 flex items-baseline gap-2">
							<span class="min-w-0 flex-1 truncate text-xs">
								{CATEGORY_LABELS[category.category]}
							</span>
							<span class="tabular text-xs text-muted-foreground">
								{Math.round(category.share * 100)}%
							</span>
							<span class="tabular text-xs font-medium">{money(category.amount)}</span>
						</div>
						<div class="h-1 overflow-hidden rounded-full bg-line">
							<div
								class="h-full rounded-full bg-lavender"
								style="width: {Math.round(category.share * 100)}%"
							></div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</GlassCard>
</div>
