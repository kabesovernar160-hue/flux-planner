<script lang="ts">
	import { CheckCircle, Fire, ForkKnife, Lock, Scales, Star, Wallet } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import LineChart from '$lib/components/ui/line-chart.svelte';
	import PeriodBars from '$lib/components/ui/period-bars.svelte';
	import { CATEGORY_LABELS } from '$lib/services/financeService';
	import { weightChange, weightProgress, weightSeries } from '$lib/services/weightService';
	import { billing } from '$lib/state/billing.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import {
		average,
		averageMacros,
		averageOfActive,
		caloriesByDay,
		caloriesByMeal,
		changeShare,
		expensesByCategory,
		habitRateByDay,
		incomeByDay,
		previousEnd,
		spendingByDay,
		totalOf
	} from '$lib/utils/analytics';
	import { formatMacro, formatMoney, formatNumber, formatWeight } from '$lib/utils/format';

	/**
	 * Неделя, месяц и квартал.
	 *
	 * Первые две — привычные рамки, между которыми есть смысл сравнивать.
	 * Квартал выходит за глубину бесплатного тарифа: это и есть то самое
	 * «вся история» на Pro, обещанное в условиях.
	 */
	const PERIODS = [
		{ days: 7, label: '7 дней' },
		{ days: 30, label: '30 дней' },
		{ days: 90, label: '90 дней' },
		{ days: 365, label: 'Год' }
	];

	let days = $state(7);

	/** Глубина истории на текущем тарифе. null — ограничения нет. */
	const historyDays = $derived(billing.historyDays);

	const locked = (value: number) => historyDays !== null && value > historyDays;

	/** Показывать ли объяснение. Появляется после нажатия на закрытый период. */
	let lockExplained = $state(false);

	// Подписка могла кончиться, пока экран открыт: выбранный период
	// сам возвращается в разрешённые рамки, а не показывает лишнее.
	$effect(() => {
		if (locked(days)) days = historyDays ?? PERIODS[0].days;
	});

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
	const weights = $derived(weightSeries(end, days));
	const weightDelta = $derived(weightChange(end, days));
	const latest = $derived(plannerStore.latestWeight);
	const progress = $derived(weightProgress(end, days));

	const habitRate = $derived(
		habitRateByDay(plannerStore.habits, plannerStore.habitCompletions, end, days)
	);

	// Среднее считается по дням с записями: пропущенные дни изображали бы
	// дефицит, которого не было.
	const avgCalories = $derived(averageOfActive(calories));
	const trackedDays = $derived(calories.filter((day) => day.value > 0).length);

	/**
	 * Прошлый период такой же длины.
	 *
	 * «1 800 ккал в среднем» — число в вакууме: много это или мало, понятно
	 * только рядом с прошлой неделей. Считается из тех же записей, лишних
	 * запросов не требует.
	 */
	const before = $derived(previousEnd(end, days));

	const caloriesTrend = $derived(
		changeShare(avgCalories, averageOfActive(caloriesByDay(plannerStore.foodEntries, before, days)))
	);

	const spendingTrend = $derived(
		changeShare(
			totalOf(spending),
			totalOf(spendingByDay(plannerStore.financeEntries, before, days))
		)
	);

	/** Ниже этого порога разница — шум, а не изменение. */
	const NOISE = 0.03;

	function trendText(change: number | null): string | null {
		if (change === null) return null;
		if (Math.abs(change) < NOISE) return `Столько же, сколько в прошлые ${days} дней.`;

		// Рост больше чем вдвое читается разами, а не процентами: «на 464 %»
		// приходится переводить в уме, «в 5,6 раза» — нет.
		if (change >= 1) {
			const times = (1 + change).toFixed(1).replace('.', ',');
			return `В ${times} раза больше, чем в прошлые ${days} дней.`;
		}

		const percent = Math.round(Math.abs(change) * 100);
		return `На ${percent} % ${change > 0 ? 'больше' : 'меньше'}, чем в прошлые ${days} дней.`;
	}

	const avgSpending = $derived(average(spending));
	const totalSpending = $derived(totalOf(spending));
	const habitPercent = $derived(Math.round(average(habitRate) * 100));

	const goal = $derived(plannerStore.todayNutrition.calorieGoal);
	const budget = $derived(plannerStore.todayFinance.budget);

	function pickPeriod(value: number) {
		if (locked(value)) {
			// Закрытый период не выбирается молча: человек должен понять,
			// что это не поломка, а граница тарифа.
			telegram.haptic.notification('warning');
			lockExplained = true;
			return;
		}

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
			class="flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-xs font-medium
			       transition-colors duration-400 ease-flux
			       {days === period.days ? 'bg-lavender text-void' : 'text-muted-foreground'}
			       {locked(period.days) ? 'text-muted-foreground/50' : ''}"
		>
			{#if locked(period.days)}
				<Lock size={12} weight="light" />
			{/if}
			{period.label}
		</button>
	{/each}
</div>

{#if lockExplained}
	<GlassCard class="mb-4">
		<p class="text-xs leading-relaxed text-muted-foreground">
			На бесплатном тарифе аналитика показывает последние {historyDays} дней. Записи старше никуда не
			делись — они на устройстве и в выгрузке, и снова откроются на Pro.
		</p>
		<a
			href="/settings"
			class="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-lavender py-2.5
			       text-sm font-medium text-void shadow-accent transition-transform duration-500
			       ease-flux active:scale-[0.98]"
		>
			<Star size={15} weight="fill" />
			Посмотреть тариф
		</a>
	</GlassCard>
{/if}

<div class="flex flex-col gap-4">
	<GlassCard tone="amber">
		<div class="mb-3 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<ForkKnife size={15} weight="regular" class="text-tone" />
			</span>
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
				{#if trendText(caloriesTrend)}
					<span class="text-foreground/70">{trendText(caloriesTrend)}</span>
				{/if}
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
										class="h-full rounded-full bg-tone"
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
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<Scales size={15} weight="regular" class="text-tone" />
			</span>
			<h2 class="flex-1 text-sm font-medium">Вес</h2>
			{#if latest}
				<span class="tabular text-xs text-muted-foreground">{latest.date}</span>
			{/if}
		</div>

		{#if !latest}
			<p class="py-2 text-sm text-muted-foreground">
				Взвешиваний пока нет. Цели считаются от веса, и его стоит отмечать хотя бы раз в неделю.
			</p>
			<button
				type="button"
				onclick={() => ui.openWeightSheet()}
				class="mt-2 w-full rounded-full border border-line-strong py-2.5 text-xs font-medium
				       transition-[transform,border-color] duration-500 ease-flux
				       hover:border-tone/60 active:scale-[0.98]"
			>
				Записать вес
			</button>
		{:else}
			<p class="tabular text-3xl leading-none font-semibold tracking-tight">
				{formatWeight(latest.weightKg)}
				<span class="text-sm font-normal text-muted-foreground">кг</span>
			</p>

			{#if weightDelta === null}
				<p class="mt-1 text-xs text-muted-foreground">
					За период одно взвешивание — динамику покажут два и больше.
				</p>
			{:else}
				<!--
					Ноль важен не меньше роста и снижения: «вес не изменился» —
					это ответ, а не отсутствие данных.
				-->
				<p class="mt-1 text-xs text-muted-foreground">
					{#if weightDelta === 0}
						За период вес не изменился.
					{:else}
						{weightDelta > 0 ? '+' : '−'}{formatWeight(Math.abs(weightDelta))} кг за период.
					{/if}
				</p>
			{/if}

			<div class="mt-4">
				<LineChart values={weights} format={formatWeight} />
			</div>

			{#if progress}
				<!--
					Прогноз выдаётся только при движении к цели и достаточной
					истории: дата, посчитанная по одному килограмму, читается
					как обещание, которого никто не давал.
				-->
				<div class="mt-4 border-t border-line/70 pt-3 text-xs text-muted-foreground">
					{#if progress.remainingKg <= 0.1 && progress.remainingKg >= -0.1}
						<p>Цель {formatWeight(progress.goalKg)} кг достигнута.</p>
					{:else}
						<p>
							До цели {formatWeight(progress.goalKg)} кг —
							{formatWeight(Math.abs(progress.remainingKg))} кг
							{progress.remainingKg > 0 ? 'вниз' : 'вверх'}.
						</p>
					{/if}

					{#if progress.perWeekKg !== null && progress.perWeekKg !== 0}
						<p class="mt-1">
							Темп: {progress.perWeekKg > 0 ? '+' : '−'}{formatWeight(Math.abs(progress.perWeekKg))} кг
							в неделю.
							{#if progress.etaDate}
								При нём цель — около {progress.etaDate}.
							{/if}
						</p>
					{/if}
				</div>
			{/if}
		{/if}
	</GlassCard>

	<GlassCard tone="mint">
		<div class="mb-3 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<CheckCircle size={15} weight="regular" class="text-tone" />
			</span>
			<h2 class="flex-1 text-sm font-medium">Привычки</h2>
			<span class="tabular text-xs text-muted-foreground">{habitPercent}%</span>
		</div>

		{#if plannerStore.habits.length === 0}
			<p class="py-2 text-sm text-muted-foreground">
				Привычек ещё нет. <a href="/habits" class="text-tone">Добавить первую</a>.
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
					<Fire size={16} weight="fill" class="shrink-0 text-tone" />
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

	<GlassCard tone="sky">
		<div class="mb-3 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<Wallet size={15} weight="regular" class="text-tone" />
			</span>
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
				{#if trendText(spendingTrend)}
					<span class="text-foreground/70">{trendText(spendingTrend)}</span>
				{/if}
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
								class="h-full rounded-full bg-tone"
								style="width: {Math.round(category.share * 100)}%"
							></div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</GlassCard>
</div>
