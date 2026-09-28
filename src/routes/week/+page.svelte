<script lang="ts">
	import {
		Camera,
		CaretLeft,
		CaretRight,
		CheckCircle,
		Compass,
		ForkKnife,
		ListChecks,
		Plus,
		Scales,
		ShareFat,
		Sparkle,
		Wallet
	} from 'phosphor-svelte';
	import type { Component } from 'svelte';
	import { page } from '$app/state';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import PeriodBars from '$lib/components/ui/period-bars.svelte';
	import { shareWeek, weekDataFromStore } from '$lib/services/weekService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { addDays, getToday, isDateKey } from '$lib/utils/date';
	import { formatMoney, formatNumber, formatWeight, pluralDays } from '$lib/utils/format';
	import {
		buildWeekReport,
		compareWeeks,
		formatChange,
		percent,
		weekAdvice,
		weekInsights,
		weekLabel,
		weekStartOf,
		type WeekDay
	} from '$lib/utils/weekly';

	const today = $derived(getToday(plannerStore.doc.user.timezone));
	const currentStart = $derived(weekStartOf(today));

	/**
	 * Показанная неделя.
	 *
	 * Из адреса берётся только первая: ссылка с главной в понедельник ведёт
	 * на прошедшую неделю, а не на только что начавшуюся пустую. Дальше
	 * листание стрелками — внутреннее состояние экрана, историю переходов
	 * Telegram оно не засоряет.
	 */
	const requested = page.url.searchParams.get('start');
	let start = $state(
		isDateKey(requested)
			? weekStartOf(requested)
			: weekStartOf(getToday(plannerStore.doc.user.timezone))
	);

	const isCurrent = $derived(start === currentStart);
	const canGoForward = $derived(start < currentStart);

	function shift(weeks: number) {
		telegram.haptic.selection();
		start = addDays(start, weeks * 7);
	}

	const data = $derived(weekDataFromStore());
	const report = $derived(buildWeekReport(data, start, today));
	const previous = $derived(buildWeekReport(data, addDays(start, -7)));
	const comparison = $derived(compareWeeks(report, previous));
	const insights = $derived(weekInsights(report, previous));
	const advice = $derived(weekAdvice(report));

	const currency = $derived(plannerStore.doc.settings.currency);
	const locale = $derived(plannerStore.doc.settings.locale);
	const money = (value: number) => formatMoney(value, currency, locale);

	const habitsPercent = $derived(percent(report.habits.rate));
	const previousHabitsPercent = $derived(percent(comparison.previousHabitRate));
	const topCategory = $derived(report.finance.byCategory[0] ?? null);

	const CATEGORY_NAMES: Record<string, string> = {
		food: 'еда',
		transport: 'транспорт',
		shopping: 'покупки',
		entertainment: 'развлечения',
		health: 'здоровье',
		education: 'образование',
		subscriptions: 'подписки',
		other: 'другое'
	};

	/* ───────────── Герой: семь дней ───────────── */

	const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

	/** Дни, которые уже наступили: у текущей недели будущие не в счёт. */
	const passedDays = $derived(report.days.filter((day) => day.date <= today).length);

	/**
	 * Заголовок героя — оценка словами, а не пересказ цифры.
	 *
	 * Ни одна формулировка не упрекает: неделя с двумя днями записей —
	 * это «начало», а не «провал». Пропуски и так видны по кольцу.
	 */
	const verdict = $derived.by(() => {
		const active = report.activeDays;
		if (isCurrent && active === passedDays && active > 0 && active < 7) return 'Пока без пропусков';
		if (active === 7) return 'Каждый день недели';
		if (active >= 5) return 'Ровная неделя';
		if (active >= 3) return 'Половина недели в записях';
		return 'Начало положено';
	});

	/**
	 * Кольцо из семи дуг, по одной на день, понедельник сверху.
	 *
	 * Кольцо, а не полоска: семь сегментов складываются в целое, и незакрытая
	 * дуга читается как «чуть-чуть до полного круга» — это мотивирует
	 * сильнее, чем пустая клетка в таблице.
	 */
	const RING = 124;
	const RING_R = 52;
	const RING_STROKE = 9;
	/** Зазор между дугами с запасом на скруглённые концы: иначе дни слипаются в сплошной круг. */
	const GAP_DEG = 15;

	function arc(index: number): string {
		const slice = 360 / 7;
		const from = ((-90 + index * slice + GAP_DEG / 2) * Math.PI) / 180;
		const to = ((-90 + (index + 1) * slice - GAP_DEG / 2) * Math.PI) / 180;
		const c = RING / 2;
		const x1 = c + RING_R * Math.cos(from);
		const y1 = c + RING_R * Math.sin(from);
		const x2 = c + RING_R * Math.cos(to);
		const y2 = c + RING_R * Math.sin(to);
		return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${RING_R} ${RING_R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
	}

	/**
	 * Что записано в день: три точки в цветах разделов.
	 * Привычка засчитывается по одной закрытой — день «был», даже если не всё.
	 */
	function marks(day: WeekDay) {
		return [
			{ key: 'food', tone: 'tone-amber', on: day.calories > 0, label: 'еда' },
			{ key: 'habits', tone: 'tone-mint', on: day.habitsDone > 0, label: 'привычки' },
			{ key: 'money', tone: 'tone-sky', on: day.spent > 0, label: 'траты' }
		];
	}

	function dayLabel(day: WeekDay, index: number): string {
		const recorded = marks(day)
			.filter((mark) => mark.on)
			.map((mark) => mark.label);
		const [, , date] = day.date.split('-').map(Number);
		if (day.date > today) return `${WEEKDAYS[index]}, ${date}: ещё не наступил`;
		return `${WEEKDAYS[index]}, ${date}: ${recorded.length > 0 ? recorded.join(', ') : 'без записей'}`;
	}
</script>

{#snippet change(value: number | null)}
	{@const label = formatChange(value)}
	{#if label}
		<!--
			Стрелки без цвета: меньше калорий или больше трат — хорошо это
			или плохо, зависит от цели человека, а не от знака.
		-->
		<span
			class="tabular shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-foreground/80"
			title="К прошлой неделе"
		>
			{label.arrow}
			{label.text}
		</span>
	{/if}
{/snippet}

{#snippet sectionTitle(Icon: Component, title: string)}
	<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
		<Icon size={15} weight="regular" class="text-tone" />
	</span>
	<h2 class="flex-1 text-sm font-medium">{title}</h2>
{/snippet}

<!--
	Кольцо недели. filled — сколько дуг гореть (для пустой недели — ни одной),
	остальное приглушено; текущий день обведён, будущие — пунктиром.
-->
{#snippet ring(days: WeekDay[], showNumber: boolean)}
	<div class="relative shrink-0" style="width: {RING}px; height: {RING}px;">
		<svg viewBox="0 0 {RING} {RING}" width={RING} height={RING} aria-hidden="true" class="block">
			<defs>
				<linearGradient id="week-ring" x1="0" x2="1" y1="0" y2="1">
					<stop offset="0%" stop-color="var(--fx-lavender-hi)" />
					<stop offset="100%" stop-color="var(--fx-lavender-lo)" />
				</linearGradient>
			</defs>
			{#each days as day, index (day.date)}
				<path
					d={arc(index)}
					fill="none"
					stroke-width={RING_STROKE}
					stroke-linecap="round"
					stroke={day.date > today ? 'oklch(1 0 0 / 0.05)' : 'oklch(1 0 0 / 0.09)'}
				/>
				{#if day.hasAnything}
					<path
						d={arc(index)}
						pathLength="1"
						fill="none"
						stroke-width={RING_STROKE}
						stroke-linecap="round"
						stroke="url(#week-ring)"
						class="fx-draw"
						style="animation-delay: {160 + index * 60}ms;"
					/>
				{/if}
			{/each}
		</svg>
		{#if showNumber}
			<div class="absolute inset-0 grid place-items-center">
				<p class="fx-num text-5xl leading-none">
					{report.activeDays}<span class="text-xl text-muted-foreground">/7</span>
				</p>
			</div>
		{:else}
			<div class="absolute inset-0 grid place-items-center">
				<Sparkle size={28} weight="light" class="text-lavender" />
			</div>
		{/if}
	</div>
{/snippet}

<PageHeader
	title="Итоги недели"
	subtitle={isCurrent ? 'Эта неделя' : 'Прошедшая неделя'}
	back="/"
/>

<!-- Переключатель недель: неделя — единица отчёта, поэтому листается целиком. -->
<div
	class="fx-rise mb-4 flex items-center gap-2 rounded-full border border-line/70 bg-white/[0.02] p-1
	       shadow-[inset_0_1px_0_0_var(--fx-glass-highlight)]"
	style="--fx-step: 0;"
>
	<button
		type="button"
		onclick={() => shift(-1)}
		aria-label="Предыдущая неделя"
		class="grid size-10 shrink-0 place-items-center rounded-full transition-[transform,background-color]
		       duration-500 ease-flux hover:bg-white/[0.04] active:scale-90"
	>
		<CaretLeft size={16} weight="light" />
	</button>
	<p class="tabular flex-1 text-center text-sm font-medium" aria-live="polite">
		{weekLabel(start)}
	</p>
	<button
		type="button"
		onclick={() => shift(1)}
		disabled={!canGoForward}
		aria-label="Следующая неделя"
		class="grid size-10 shrink-0 place-items-center rounded-full transition-[transform,background-color]
		       duration-500 ease-flux hover:bg-white/[0.04] active:scale-90
		       disabled:text-muted-foreground/30 disabled:hover:bg-transparent disabled:active:scale-100"
	>
		<CaretRight size={16} weight="light" />
	</button>
</div>

{#if report.isEmpty}
	<!--
		Пустая неделя — не таблица нулей, а объяснение, откуда возьмутся
		итоги, и одна кнопка. Нули читаются как «ты ничего не сделал».
	-->
	<div class="fx-rise" style="--fx-step: 1;">
		<GlassCard bezel>
			<div class="flex flex-col items-center py-4 text-center">
				{@render ring(report.days, false)}
				{#if isCurrent}
					<h2 class="mt-5 text-base font-semibold tracking-tight">Здесь соберутся итоги недели</h2>
					<p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
						Одна запись в день — еда, привычка или трата — и к воскресенью кольцо сомкнётся в
						картину недели.
					</p>
					<button
						type="button"
						onclick={() => ui.openCreateSheet()}
						class="mt-5 flex min-h-10 items-center gap-2 rounded-full bg-lavender px-5 py-2.5
						       text-sm font-medium text-void shadow-accent transition-transform duration-500
						       ease-flux hover:bg-lavender-hi active:scale-[0.98]"
					>
						<Plus size={15} weight="bold" />
						Сделать запись
					</button>
				{:else}
					<h2 class="mt-5 text-base font-semibold tracking-tight">Эта неделя прошла без записей</h2>
					<p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
						Бывает. Итоги считаются только из того, что записано, — загляните в неделю поновее.
					</p>
					<button
						type="button"
						onclick={() => {
							telegram.haptic.selection();
							start = currentStart;
						}}
						class="mt-5 min-h-10 rounded-full border border-line-strong px-5 py-2.5 text-sm
						       font-medium transition-transform duration-500 ease-flux active:scale-[0.98]"
					>
						К этой неделе
					</button>
				{/if}
			</div>
		</GlassCard>
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<!-- Герой: дни с записями — общее для всех разделов мерило недели. -->
		<div class="fx-rise" style="--fx-step: 1;">
			<GlassCard bezel>
				<!--
					Сияние в цветах всех разделов: итоги — единственный экран, где
					еда, привычки и деньги собраны вместе. Слабое и неподвижное.
				-->
				<div aria-hidden="true" class="pointer-events-none absolute -inset-5 overflow-hidden">
					<span
						class="absolute -top-20 -left-16 size-56 rounded-full opacity-[0.16] blur-3xl"
						style="background: var(--fx-lavender);"
					></span>
					<span
						class="absolute -top-16 right-0 size-40 rounded-full opacity-[0.08] blur-3xl"
						style="background: var(--fx-amber);"
					></span>
					<span
						class="absolute top-24 -right-16 size-44 rounded-full opacity-[0.07] blur-3xl"
						style="background: var(--fx-mint);"
					></span>
					<span
						class="absolute top-40 left-10 size-40 rounded-full opacity-[0.06] blur-3xl"
						style="background: var(--fx-sky);"
					></span>
				</div>

				<div class="relative">
					<div class="flex items-center gap-5">
						{@render ring(report.days, true)}
						<div class="min-w-0">
							<p class="text-xs text-muted-foreground">
								{report.activeDays}&nbsp;{pluralDays(report.activeDays)} с записями
							</p>
							<h2 class="mt-1 text-lg leading-snug font-semibold tracking-tight">{verdict}</h2>
							{#if isCurrent && passedDays < 7}
								<p class="mt-1 text-xs text-muted-foreground">
									Прошло {passedDays}&nbsp;{pluralDays(passedDays)} из 7
								</p>
							{/if}
						</div>
					</div>

					<!--
						Мозаика недели: что именно записано в каждый день. Кольцо
						отвечает «сколько», мозаика — «чего не хватало».
					-->
					<ul class="mt-5 grid grid-cols-7 gap-1.5">
						{#each report.days as day, index (day.date)}
							{@const future = day.date > today}
							{@const isToday = day.date === today}
							<li
								class="flex flex-col items-center gap-2 rounded-xl py-2
								       {isToday ? 'bg-lavender/10 ring-1 ring-lavender/30' : 'bg-white/[0.025]'}"
							>
								<span class="sr-only">{dayLabel(day, index)}</span>
								<span
									aria-hidden="true"
									class="text-[11px] leading-none
									       {isToday
										? 'font-medium text-lavender-hi'
										: future
											? 'text-muted-foreground/45'
											: 'text-muted-foreground'}"
								>
									{WEEKDAYS[index]}
								</span>
								<span class="flex flex-col gap-1" aria-hidden="true">
									{#each marks(day) as mark (mark.key)}
										<span
											class="{mark.tone} size-1.5 rounded-full
											       {mark.on ? 'bg-tone' : future ? 'bg-white/[0.05]' : 'bg-white/[0.1]'}"
										></span>
									{/each}
								</span>
							</li>
						{/each}
					</ul>
					<p
						class="mt-2.5 flex items-center justify-center gap-3 text-[11px] text-muted-foreground"
						aria-hidden="true"
					>
						<span class="tone-amber flex items-center gap-1.5">
							<span class="size-1.5 rounded-full bg-tone"></span>еда
						</span>
						<span class="tone-mint flex items-center gap-1.5">
							<span class="size-1.5 rounded-full bg-tone"></span>привычки
						</span>
						<span class="tone-sky flex items-center gap-1.5">
							<span class="size-1.5 rounded-full bg-tone"></span>траты
						</span>
					</p>

					{#if insights.length > 0}
						<ul class="mt-5 flex flex-col gap-2.5 border-t border-line/60 pt-4">
							{#each insights as insight (insight)}
								<li class="flex items-start gap-2.5 text-sm leading-relaxed">
									<Sparkle size={15} weight="fill" class="mt-[3px] shrink-0 text-lavender" />
									<span>{insight}</span>
								</li>
							{/each}
						</ul>
					{/if}

					<button
						type="button"
						onclick={() => shareWeek(report)}
						class="mt-5 flex min-h-10 w-full items-center justify-center gap-2 rounded-full
						       bg-lavender py-3 text-sm font-medium text-void shadow-accent
						       transition-transform duration-500 ease-flux hover:bg-lavender-hi
						       active:scale-[0.98]"
					>
						<ShareFat size={16} weight="fill" />
						Поделиться итогами
					</button>
					<p class="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
						В сообщение уйдут только проценты и серии — без калорий и денег
					</p>
				</div>
			</GlassCard>
		</div>

		<div class="fx-rise" style="--fx-step: 2;">
			<GlassCard tone="amber">
				<div class="mb-4 flex items-center gap-2">
					{@render sectionTitle(ForkKnife, 'Еда')}
					{@render change(comparison.calories)}
				</div>

				{#if report.nutrition.trackedDays === 0}
					{#if isCurrent}
						<div class="tone-amber">
							<p class="text-sm leading-relaxed text-muted-foreground">
								Средние калории и дни в цели появятся после первой записи еды.
							</p>
							<button
								type="button"
								onclick={() => ui.openFoodSheet()}
								class="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-full
								       border border-tone/30 bg-tone/10 py-2.5 text-sm font-medium
								       transition-transform duration-500 ease-flux active:scale-[0.98]"
							>
								<Camera size={16} weight="regular" class="text-tone" />
								Сфоткать еду
							</button>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">На этой неделе еду не записывали.</p>
					{/if}
				{:else}
					<div class="flex items-end gap-4">
						<div class="min-w-0 flex-1">
							<p class="fx-num text-3xl leading-none">
								{formatNumber(Math.round(report.nutrition.avgCalories))}
							</p>
							<p class="mt-1.5 text-xs text-muted-foreground">ккал в среднем за день</p>
							<!-- «В цели 0 из 3» — упрёк, а не вывод: без попаданий — просто число дней. -->
							<p class="mt-3 text-xs text-muted-foreground">
								{#if report.nutrition.inGoalDays > 0}
									<span class="tabular font-medium text-foreground/85">
										В цели {report.nutrition.inGoalDays} из {report.nutrition.trackedDays}
									</span>
									{report.nutrition.trackedDays === 1 ? 'дня' : 'дней'} с записями
								{:else}
									<span class="tabular font-medium text-foreground/85">
										{report.nutrition.trackedDays}&nbsp;{pluralDays(report.nutrition.trackedDays)}
									</span>
									с записями
								{/if}
							</p>
						</div>
						<div class="w-[8.5rem] shrink-0">
							<PeriodBars
								values={report.nutrition.byDay}
								goal={report.nutrition.goal}
								highlight={isCurrent ? today : undefined}
								unit="ккал"
								label="Калории по дням недели"
								height={64}
								axis={false}
							/>
						</div>
					</div>
				{/if}
			</GlassCard>
		</div>

		<div class="fx-rise" style="--fx-step: 3;">
			<GlassCard tone="mint">
				<div class="mb-4 flex items-center gap-2">
					{@render sectionTitle(CheckCircle, 'Привычки')}
					{#if previousHabitsPercent !== null && habitsPercent !== null}
						<span
							class="tabular shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-foreground/80"
						>
							было {previousHabitsPercent} %
						</span>
					{/if}
				</div>

				{#if habitsPercent === null}
					<p class="text-sm text-muted-foreground">На неделе не было запланированных привычек.</p>
				{:else}
					<div class="flex items-end gap-4">
						<div class="min-w-0 flex-1">
							<p class="fx-num text-3xl leading-none">
								{habitsPercent}<span class="font-sans text-lg font-normal text-muted-foreground"
									>&nbsp;%</span
								>
							</p>
							<p class="mt-1.5 text-xs text-muted-foreground">
								закрыто {report.habits.done} из {report.habits.planned}
							</p>
							{#if report.habits.bestStreak > 0}
								<p class="mt-3 text-xs text-muted-foreground">
									<span class="tabular font-medium text-foreground/85">
										Серия {report.habits.bestStreak}&nbsp;{pluralDays(report.habits.bestStreak)}
									</span>
									подряд
								</p>
							{/if}
						</div>
						<div class="w-[8.5rem] shrink-0">
							<PeriodBars
								values={report.habits.byDay}
								goal={100}
								highlight={isCurrent ? today : undefined}
								unit="%"
								label="Привычки по дням недели"
								height={64}
								axis={false}
							/>
						</div>
					</div>
				{/if}
			</GlassCard>
		</div>

		<div class="fx-rise" style="--fx-step: 4;">
			<GlassCard tone="sky">
				<div class="mb-4 flex items-center gap-2">
					{@render sectionTitle(Wallet, 'Траты')}
					{@render change(comparison.spent)}
				</div>

				{#if report.finance.spent === 0}
					<p class="text-sm text-muted-foreground">Трат на этой неделе не записано.</p>
				{:else}
					<div class="flex items-end gap-4">
						<div class="min-w-0 flex-1">
							<p class="fx-num truncate text-3xl leading-none">{money(report.finance.spent)}</p>
							<p class="mt-1.5 text-xs text-muted-foreground">
								{isCurrent ? 'лимит по сегодня' : 'лимит недели'}
								{money(report.finance.budget)}
							</p>
							<p class="mt-3 text-xs leading-relaxed text-muted-foreground">
								{#if report.finance.overBudgetDays > 0}
									<span class="tabular font-medium text-foreground/85">
										Сверх лимита {report.finance.overBudgetDays}&nbsp;{pluralDays(
											report.finance.overBudgetDays
										)}
									</span>
									<br />
								{/if}
								{#if topCategory}
									больше всего — {CATEGORY_NAMES[topCategory.category] ?? 'другое'}
								{/if}
							</p>
						</div>
						<div class="w-[8.5rem] shrink-0">
							<PeriodBars
								values={report.finance.byDay}
								goal={report.finance.dailyBudget}
								highlight={isCurrent ? today : undefined}
								format={(value) => money(Math.round(value))}
								label="Траты по дням недели"
								height={64}
								axis={false}
								warnOverGoal
							/>
						</div>
					</div>
				{/if}
			</GlassCard>
		</div>

		<div class="fx-rise grid grid-cols-2 gap-4" style="--fx-step: 5;">
			<GlassCard padding="sm">
				<div class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
					<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
						<ListChecks size={15} weight="regular" class="text-tone" />
					</span>
					План
				</div>
				{#if report.plan.total === 0}
					<p class="text-sm text-muted-foreground">Дел не было</p>
				{:else}
					<p class="fx-num text-3xl leading-none">
						{report.plan.done}<span class="text-lg text-muted-foreground">/{report.plan.total}</span
						>
					</p>
					<div class="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
						<div
							class="h-full rounded-full bg-tone"
							style="width: {Math.round((report.plan.done / report.plan.total) * 100)}%"
						></div>
					</div>
					<p class="mt-2 text-[11px] text-muted-foreground">дел выполнено</p>
				{/if}
			</GlassCard>

			<GlassCard padding="sm">
				<div class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
					<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
						<Scales size={15} weight="regular" class="text-tone" />
					</span>
					Вес
				</div>
				{#if report.weight.change === null}
					<p class="text-sm text-muted-foreground">
						{report.weight.to === null ? 'Не взвешивались' : `${formatWeight(report.weight.to)} кг`}
					</p>
				{:else}
					<p class="fx-num text-3xl leading-none">
						{report.weight.change > 0 ? '+' : report.weight.change < 0 ? '−' : ''}{formatWeight(
							Math.abs(report.weight.change)
						)}<span class="font-sans text-sm font-normal text-muted-foreground">&nbsp;кг</span>
					</p>
					<p class="mt-2 text-[11px] text-muted-foreground">
						сейчас {formatWeight(report.weight.to ?? 0)} кг
					</p>
				{/if}
			</GlassCard>
		</div>

		<!-- Один совет: из пяти не выполняется ни один. -->
		<div class="fx-rise" style="--fx-step: 6;">
			<GlassCard bezel>
				<div class="mb-3 flex items-center gap-2">
					{@render sectionTitle(Compass, 'На следующую неделю')}
				</div>
				<p class="text-sm leading-relaxed">{advice}</p>
			</GlassCard>
		</div>
	</div>
{/if}
