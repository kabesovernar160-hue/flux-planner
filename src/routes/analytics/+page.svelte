<script lang="ts">
	import {
		Camera,
		CheckCircle,
		Fire,
		ForkKnife,
		Lock,
		Plus,
		Scales,
		Star,
		Wallet
	} from 'phosphor-svelte';
	import type { Component } from 'svelte';
	import EmptyAction from '$lib/components/ui/empty-action.svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import LineChart from '$lib/components/ui/line-chart.svelte';
	import PeriodBars from '$lib/components/ui/period-bars.svelte';
	import { CATEGORY_LABELS } from '$lib/services/financeService';
	import { weightChange, weightProgress, weightSeries } from '$lib/services/weightService';
	import { billing } from '$lib/state/billing.svelte';
	import InviteNudge from '$lib/components/referrals/invite-nudge.svelte';
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
	import { addDays, getToday } from '$lib/utils/date';
	import {
		formatMacro,
		formatMoney,
		formatNumber,
		formatWeight,
		pluralDays
	} from '$lib/utils/format';

	/**
	 * Неделя, месяц, квартал и год.
	 *
	 * Первые две — привычные рамки, между которыми есть смысл сравнивать.
	 * Длинные периоды выходят за глубину бесплатного тарифа: это и есть
	 * «вся история» на Pro, обещанная в условиях.
	 */
	const PERIODS = [
		{ days: 7, label: '7 дней', previous: 'к прошлым 7 дням' },
		{ days: 30, label: '30 дней', previous: 'к прошлым 30 дням' },
		{ days: 90, label: '90 дней', previous: 'к прошлым 90 дням' },
		{ days: 365, label: 'Год', previous: 'к прошлому году' }
	];

	let days = $state(7);
	const periodIndex = $derived(
		Math.max(
			0,
			PERIODS.findIndex((period) => period.days === days)
		)
	);
	const previousLabel = $derived(PERIODS[periodIndex].previous);

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
	const today = $derived(getToday(plannerStore.doc.user.timezone));
	const currency = $derived(plannerStore.doc.settings.currency);
	const locale = $derived(plannerStore.doc.settings.locale);
	const money = (value: number) => formatMoney(value, currency, locale);

	/**
	 * Знак валюты отдельно от числа.
	 *
	 * В цифре-герое сумма набирается моно-начертанием, а «₽» рядом с ней
	 * в том же размере весит как ещё одна цифра. Знак берётся из самого
	 * форматтера, поэтому доллар остаётся слева, а рубль — справа.
	 */
	const currencySign = $derived(money(0).replace(/[\d\s  .,]/g, ''));
	const signFirst = $derived(money(0).trim().indexOf(currencySign) === 0);

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

	const avgSpending = $derived(average(spending));
	const totalSpending = $derived(totalOf(spending));
	const habitPercent = $derived(Math.round(average(habitRate) * 100));

	/**
	 * Привычки прошлого периода — в процентах, а не относительным изменением.
	 * «На 12 % больше от 60 %» заставляет считать процент от процента;
	 * «было 60 %» читается сразу.
	 */
	const previousHabitPercent = $derived.by(() => {
		const rate = habitRateByDay(plannerStore.habits, plannerStore.habitCompletions, before, days);
		// Привычек тогда ещё не было — сравнивать не с чем.
		const createdBefore = plannerStore.habits.some(
			(habit) => !habit.createdAt || habit.createdAt.slice(0, 10) <= before
		);
		return createdBefore ? Math.round(average(rate) * 100) : null;
	});

	const goal = $derived(plannerStore.todayNutrition.calorieGoal);
	const budget = $derived(plannerStore.todayFinance.budget);

	/**
	 * Доли энергии от белков, жиров и углеводов.
	 *
	 * Граммы между собой не сравниваются — грамм жира вдвое калорийнее
	 * грамма белка. Полоска показывает, из чего сложены калории.
	 */
	const macroEnergy = $derived.by(() => {
		const protein = macros.protein * 4;
		const fat = macros.fat * 9;
		const carbs = macros.carbs * 4;
		const total = protein + fat + carbs || 1;
		return [
			{ key: 'protein', label: 'Белки', grams: macros.protein, share: protein / total, alpha: 1 },
			{ key: 'fat', label: 'Жиры', grams: macros.fat, share: fat / total, alpha: 0.6 },
			{ key: 'carbs', label: 'Углеводы', grams: macros.carbs, share: carbs / total, alpha: 0.32 }
		];
	});

	/**
	 * Четыре крупные категории и «остальное».
	 *
	 * Полный список на восемь строк делает карточку длиннее ответа: куда
	 * ушли деньги, видно по первым трём-четырём.
	 */
	const categoryRows = $derived.by(() => {
		const head = categories.slice(0, 4);
		const rest = categories.slice(4);
		const rows = head.map((category, index) => ({
			key: category.category as string,
			label: CATEGORY_LABELS[category.category],
			amount: category.amount,
			share: category.share,
			alpha: [1, 0.66, 0.44, 0.28][index]
		}));
		if (rest.length > 0) {
			rows.push({
				key: 'rest',
				label: 'Остальное',
				amount: rest.reduce((total, item) => total + item.amount, 0),
				share: rest.reduce((total, item) => total + item.share, 0),
				alpha: 0.16
			});
		}
		return rows;
	});

	/* ───────────── Подписи ───────────── */

	const MONTHS_OF = [
		'января',
		'февраля',
		'марта',
		'апреля',
		'мая',
		'июня',
		'июля',
		'августа',
		'сентября',
		'октября',
		'ноября',
		'декабря'
	];

	function dateLabel(date: string, withYear = false): string {
		const [year, month, day] = date.split('-').map(Number);
		return `${day} ${MONTHS_OF[month - 1]}${withYear ? ` ${year}` : ''}`;
	}

	/** «22–28 сентября», «30 августа — 28 сентября», с годом — если период его пересекает. */
	const rangeLabel = $derived.by(() => {
		const start = addDays(end, -(days - 1));
		const crossesYear = start.slice(0, 4) !== end.slice(0, 4);
		if (start.slice(0, 7) === end.slice(0, 7)) {
			return `${Number(start.slice(8))}–${dateLabel(end)}`;
		}
		return `${dateLabel(start, crossesYear)} — ${dateLabel(end, crossesYear)}`;
	});

	/** Ниже этого порога разница — шум, а не изменение. */
	const NOISE = 0.03;

	/**
	 * Сравнение с прошлым периодом: стрелка и величина.
	 *
	 * Рост больше чем вдвое читается разами, а не процентами: «на 464 %»
	 * приходится переводить в уме, «в 5,6 раза» — нет.
	 */
	function trendOf(change: number | null): { arrow: string; text: string } | null {
		if (change === null || !Number.isFinite(change)) return null;
		if (Math.abs(change) < NOISE) return { arrow: '→', text: 'столько же' };
		if (change >= 1) {
			return { arrow: '↑', text: `в ${(1 + change).toFixed(1).replace('.', ',')} раза` };
		}
		return { arrow: change > 0 ? '↑' : '↓', text: `${Math.round(Math.abs(change) * 100)} %` };
	}

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

{#snippet cardTitle(Icon: Component, title: string, note?: string)}
	<div class="mb-4 flex items-center gap-2">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<Icon size={15} weight="regular" class="text-tone" />
		</span>
		<h2 class="flex-1 text-sm font-medium">{title}</h2>
		{#if note}
			<span class="tabular text-xs text-muted-foreground">{note}</span>
		{/if}
	</div>
{/snippet}

<!--
	Сравнение без цвета: меньше калорий или больше трат — хорошо это или
	плохо, зависит от цели человека, а не от знака. Цвет здесь соврал бы.
-->
{#snippet trend(change: number | null)}
	{@const value = trendOf(change)}
	{#if value}
		<span class="whitespace-nowrap">
			<span class="tabular font-medium text-foreground/85">{value.arrow} {value.text}</span>
			{previousLabel}
		</span>
	{/if}
{/snippet}

{#snippet hero(value: string, unit: string, unitFirst = false)}
	<p class="flex items-baseline gap-1.5">
		{#if unitFirst}
			<span class="text-lg font-medium text-muted-foreground">{unit}</span>
		{/if}
		<!--
			Разряды разделены узким зазором, а не пробелом: в моно-начертании
			пробел шириной в цифру, и «1 450» распадалось на два числа.
		-->
		<span class="fx-num leading-none {value.length > 8 ? 'text-3xl' : 'text-5xl'}">
			{#each value.split(/[\s  ]/) as group, index (index)}
				{#if index > 0}<span class="inline-block w-[0.22em]"></span>{/if}{group}
			{/each}
		</span>
		{#if !unitFirst}
			<span class="text-sm text-muted-foreground">{unit}</span>
		{/if}
	</p>
{/snippet}

{#snippet shareBar(rows: { key: string; share: number; alpha: number }[])}
	<!-- Одна полоса долями одного тона: сразу видно, кто главный, без легенды из пяти цветов. -->
	<div class="flex h-2 gap-0.5 overflow-hidden rounded-full">
		{#each rows as row (row.key)}
			{#if row.share > 0}
				<span
					class="h-full rounded-full bg-tone first:rounded-l-full last:rounded-r-full"
					style="flex: {row.share} 1 0%; opacity: {row.alpha};"
				></span>
			{/if}
		{/each}
	</div>
{/snippet}

<PageHeader title="Аналитика" subtitle={rangeLabel} />

<!--
	Переключатель периода. Плашка выбранного пункта одна и переезжает,
	а не загорается на новом месте: так видно, откуда и куда переключились.
-->
<div
	class="fx-rise relative mb-4 grid grid-cols-4 rounded-full border border-line/70 bg-white/[0.02] p-1
	       shadow-[inset_0_1px_0_0_var(--fx-glass-highlight)]"
	style="--fx-step: 0;"
	role="group"
	aria-label="Период"
>
	<span
		aria-hidden="true"
		class="pointer-events-none absolute top-1 bottom-1 left-1 rounded-full bg-lavender/14
		       shadow-[inset_0_1px_0_0_oklch(1_0_0/0.06)] transition-transform duration-500 ease-flux"
		style="width: calc((100% - 0.5rem) / 4); transform: translateX({periodIndex * 100}%);"
	></span>
	{#each PERIODS as period (period.days)}
		<button
			type="button"
			onclick={() => pickPeriod(period.days)}
			aria-pressed={days === period.days}
			class="relative flex h-9 items-center justify-center gap-1 rounded-full text-sm transition-colors
			       duration-400 ease-flux max-[359px]:text-xs
			       {days === period.days
				? 'font-medium text-lavender-hi'
				: locked(period.days)
					? 'text-muted-foreground/55'
					: 'text-muted-foreground'}"
		>
			{#if locked(period.days)}
				<Lock size={12} weight="light" />
			{/if}
			{period.label}
		</button>
	{/each}
</div>

{#if lockExplained}
	<div class="fx-rise mb-4">
		<GlassCard>
			<p class="text-sm leading-relaxed text-muted-foreground">
				На бесплатном тарифе аналитика показывает последние {historyDays} дней. Записи старше никуда не
				делись — они на устройстве и в выгрузке, и снова откроются на Pro.
			</p>
			<a
				href="/settings"
				class="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-lavender
				       py-2.5 text-sm font-medium text-void shadow-accent transition-transform duration-500
				       ease-flux active:scale-[0.98]"
			>
				<Star size={15} weight="fill" />
				Посмотреть тариф
			</a>
		</GlassCard>
	</div>
{/if}

<!-- Над карточками: раз в неделю и закрывается крестиком, см. InviteNudge. -->
<InviteNudge />

<div class="flex flex-col gap-4">
	<div class="fx-rise" style="--fx-step: 1;">
		<GlassCard tone="amber">
			{@render cardTitle(ForkKnife, 'Калории', `цель ${formatNumber(goal)}`)}

			{#if trackedDays === 0}
				<EmptyAction
					text="Здесь будет средняя за день и за каким приёмом набегают калории."
					label="Сфоткать еду"
					icon={Camera}
					onclick={() => ui.openFoodSheet()}
				/>
			{:else}
				{@render hero(formatNumber(Math.round(avgCalories)), 'ккал')}
				<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
					в среднем за день с записями ·
					{#if trendOf(caloriesTrend)}
						{@render trend(caloriesTrend)}
					{:else}
						{trackedDays} из {days}
						{pluralDays(days)}
					{/if}
				</p>

				<div class="mt-5">
					<PeriodBars
						values={calories}
						{goal}
						highlight={today}
						aggregate="meanActive"
						unit="ккал"
						label="Калории по дням"
						warnOverGoal
					/>
				</div>

				<div class="mt-5 border-t border-line/60 pt-4">
					<p class="mb-2.5 text-xs text-muted-foreground">Из чего калории</p>
					{@render shareBar(macroEnergy)}
					<div class="mt-3 grid grid-cols-3 gap-2">
						{#each macroEnergy as macro (macro.key)}
							<div class="min-w-0">
								<p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
									<span
										class="size-1.5 shrink-0 rounded-full bg-tone"
										style="opacity: {macro.alpha};"
									></span>
									{macro.label}
								</p>
								<p class="tabular mt-1 text-sm font-medium">
									{formatMacro(macro.grams)} г
									<span class="text-xs font-normal text-muted-foreground">
										{Math.round(macro.share * 100)}%
									</span>
								</p>
							</div>
						{/each}
					</div>
				</div>

				{#if meals.length > 1}
					<!--
						Разбивка по приёмам отвечает на вопрос, который сумма за день
						не берёт: перебор набегает за ужином или его добирают перекусами.
					-->
					<div class="mt-4 border-t border-line/60 pt-4">
						<p class="mb-2.5 text-xs text-muted-foreground">По приёмам пищи</p>
						<ul class="flex flex-col gap-2.5">
							{#each meals as meal (meal.meal)}
								<li>
									<div class="mb-1.5 flex items-baseline gap-2">
										<span class="min-w-0 flex-1 truncate text-sm">{meal.label}</span>
										<span class="tabular text-xs text-muted-foreground">
											{Math.round(meal.share * 100)}%
										</span>
										<span class="tabular text-sm font-medium">
											{formatNumber(Math.round(meal.calories))}
										</span>
									</div>
									<div class="h-1 overflow-hidden rounded-full bg-white/[0.06]">
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
	</div>

	<div class="fx-rise" style="--fx-step: 2;">
		<GlassCard tone="mint">
			{@render cardTitle(CheckCircle, 'Привычки')}

			{#if plannerStore.habits.length === 0}
				<EmptyAction
					text="Здесь появятся серии и доля выполненных дней."
					label="Добавить привычку"
					icon={Plus}
					onclick={() => ui.openHabitSheet()}
				/>
			{:else}
				{@render hero(String(habitPercent), '%')}
				<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
					выполнено в среднем за день
					{#if previousHabitPercent !== null && habitPercent !== previousHabitPercent}
						·
						<span class="whitespace-nowrap">
							<span class="tabular font-medium text-foreground/85">
								{habitPercent > previousHabitPercent ? '↑' : '↓'} было {previousHabitPercent} %
							</span>
						</span>
					{/if}
				</p>

				<div class="mt-5">
					<!-- Доли 0…1 приводятся к процентам для общей шкалы графика. -->
					<PeriodBars
						values={habitRate.map((day) => ({ date: day.date, value: day.value * 100 }))}
						goal={100}
						highlight={today}
						unit="%"
						axisFormat={(value) => `${Math.round(value)}%`}
						label="Выполнение привычек по дням"
						height={96}
					/>
				</div>

				<div class="mt-5 grid grid-cols-2 gap-2">
					<div class="flex items-center gap-3 rounded-xl bg-tone/[0.07] px-3 py-3">
						<Fire size={18} weight="fill" class="shrink-0 text-tone" />
						<div class="min-w-0">
							<p class="text-[11px] text-muted-foreground">Серия сейчас</p>
							<p class="tabular mt-0.5 text-sm font-medium">
								{plannerStore.currentStreak}&nbsp;{pluralDays(plannerStore.currentStreak)}
							</p>
						</div>
					</div>
					<div class="flex items-center gap-3 rounded-xl border border-line/60 px-3 py-3">
						<Fire size={18} weight="light" class="shrink-0 text-muted-foreground" />
						<div class="min-w-0">
							<p class="text-[11px] text-muted-foreground">Лучшая серия</p>
							<p class="tabular mt-0.5 text-sm font-medium">
								{plannerStore.longestStreak}&nbsp;{pluralDays(plannerStore.longestStreak)}
							</p>
						</div>
					</div>
				</div>
			{/if}
		</GlassCard>
	</div>

	<div class="fx-rise" style="--fx-step: 3;">
		<GlassCard tone="sky">
			{@render cardTitle(Wallet, 'Траты', `лимит ${money(budget)} в день`)}

			{#if totalSpending === 0 && totalIncome === 0}
				<EmptyAction
					text="Здесь будет видно, куда уходят деньги и сколько остаётся."
					label="Записать трату"
					icon={Wallet}
					onclick={() => ui.openFinanceSheet(undefined, 'expense')}
				/>
			{:else}
				{@render hero(formatNumber(Math.round(totalSpending), locale), currencySign, signFirst)}
				<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
					за период, {money(Math.round(avgSpending))} в день
					{#if trendOf(spendingTrend)}
						· {@render trend(spendingTrend)}
					{/if}
				</p>

				<div class="mt-5">
					<PeriodBars
						values={spending}
						goal={budget}
						highlight={today}
						format={(value) => money(Math.round(value))}
						label="Траты по дням"
						height={96}
						warnOverGoal
					/>
				</div>

				{#if totalIncome > 0}
					<!--
						Доход и баланс рядом с тратами: без них «потрачено 40 000»
						не отвечает на вопрос, хорошо это или плохо.
					-->
					<div class="mt-5 grid grid-cols-2 gap-2">
						<div class="rounded-xl border border-line/60 px-3 py-2.5">
							<p class="text-[11px] text-muted-foreground">Доход</p>
							<p class="tabular mt-0.5 text-sm font-medium text-success">+{money(totalIncome)}</p>
						</div>
						<div class="rounded-xl border border-line/60 px-3 py-2.5">
							<p class="text-[11px] text-muted-foreground">Баланс</p>
							<p class="tabular mt-0.5 text-sm font-medium {balance < 0 ? 'text-destructive' : ''}">
								{balance >= 0 ? '+' : '−'}{money(Math.abs(balance))}
							</p>
						</div>
					</div>
				{/if}

				{#if categoryRows.length > 0}
					<div class="mt-5 border-t border-line/60 pt-4">
						<p class="mb-2.5 text-xs text-muted-foreground">Куда ушли</p>
						{@render shareBar(categoryRows)}
						<ul class="mt-3 flex flex-col gap-2">
							{#each categoryRows as row (row.key)}
								<li class="flex items-center gap-2.5">
									<span class="size-2 shrink-0 rounded-full bg-tone" style="opacity: {row.alpha};"
									></span>
									<span class="min-w-0 flex-1 truncate text-sm">{row.label}</span>
									<span class="tabular text-xs text-muted-foreground">
										{Math.round(row.share * 100)}%
									</span>
									<span class="tabular w-20 text-right text-sm font-medium"
										>{money(row.amount)}</span
									>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			{/if}
		</GlassCard>
	</div>

	<div class="fx-rise" style="--fx-step: 4;">
		<GlassCard>
			{@render cardTitle(
				Scales,
				'Вес',
				latest ? `${latest.date === today ? 'сегодня' : dateLabel(latest.date)}` : undefined
			)}

			{#if !latest}
				<EmptyAction
					text="Раз в неделю на весы — и здесь появится график и прогноз до цели."
					label="Записать вес"
					icon={Scales}
					onclick={() => ui.openWeightSheet()}
				/>
			{:else}
				{@render hero(formatWeight(latest.weightKg), 'кг')}
				<!--
					Ноль важен не меньше роста и снижения: «вес не изменился» —
					это ответ, а не отсутствие данных.
				-->
				<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
					{#if weightDelta === null}
						За период одно взвешивание — динамику покажут два и больше.
					{:else if weightDelta === 0}
						За период вес не изменился.
					{:else}
						<span class="tabular font-medium text-foreground/85">
							{weightDelta > 0 ? '↑ +' : '↓ −'}{formatWeight(Math.abs(weightDelta))} кг
						</span>
						за период
					{/if}
				</p>

				<div class="mt-5">
					<LineChart values={weights} format={formatWeight} goal={progress?.goalKg ?? null} />
				</div>

				{#if progress}
					<!--
						Прогноз выдаётся только при движении к цели и достаточной
						истории: дата, посчитанная по одному килограмму, читается
						как обещание, которого никто не давал.
					-->
					<div class="mt-5 border-t border-line/60 pt-4 text-sm leading-relaxed">
						{#if progress.remainingKg <= 0.1 && progress.remainingKg >= -0.1}
							<p>Цель {formatWeight(progress.goalKg)} кг достигнута.</p>
						{:else}
							<p>
								До цели {formatWeight(progress.goalKg)} кг —
								<span class="tabular font-medium">
									{formatWeight(Math.abs(progress.remainingKg))} кг
								</span>
								{progress.remainingKg > 0 ? 'вниз' : 'вверх'}
							</p>
						{/if}

						{#if progress.perWeekKg !== null && progress.perWeekKg !== 0}
							<p class="mt-1 text-xs text-muted-foreground">
								Темп {progress.perWeekKg > 0 ? '+' : '−'}{formatWeight(
									Math.abs(progress.perWeekKg)
								)} кг в неделю{#if progress.etaDate}, при нём цель — около {dateLabel(
										progress.etaDate,
										progress.etaDate.slice(0, 4) !== today.slice(0, 4)
									)}{/if}.
							</p>
						{/if}
					</div>
				{/if}
			{/if}
		</GlassCard>
	</div>
</div>
