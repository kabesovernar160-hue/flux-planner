<script lang="ts">
	import {
		CalendarBlank,
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
		weekStartOf
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
</script>

{#snippet change(value: number | null)}
	{@const label = formatChange(value)}
	{#if label}
		<!--
			Стрелки без цвета: меньше калорий или больше трат — хорошо это
			или плохо, зависит от цели человека, а не от знака.
		-->
		<span
			class="tabular shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-muted-foreground"
			title="К прошлой неделе"
		>
			{label.arrow}
			{label.text}
		</span>
	{/if}
{/snippet}

{#snippet sectionTitle(Icon: typeof ForkKnife, title: string)}
	<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
		<Icon size={15} weight="regular" class="text-tone" />
	</span>
	<h2 class="flex-1 text-sm font-medium">{title}</h2>
{/snippet}

<PageHeader
	title="Итоги недели"
	subtitle={isCurrent ? 'Эта неделя' : 'Прошедшая неделя'}
	back="/"
/>

<!-- Переключатель недель: неделя — единица отчёта, поэтому листается целиком. -->
<div
	class="fx-rise mb-4 flex items-center gap-2 rounded-full border border-line/70 bg-white/[0.02] p-1"
	style="--fx-step: 0;"
>
	<button
		type="button"
		onclick={() => shift(-1)}
		aria-label="Предыдущая неделя"
		class="grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-500
		       ease-flux active:scale-90"
	>
		<CaretLeft size={15} weight="light" />
	</button>
	<p class="flex-1 text-center text-sm font-medium">{weekLabel(start)}</p>
	<button
		type="button"
		onclick={() => shift(1)}
		disabled={!canGoForward}
		aria-label="Следующая неделя"
		class="grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-500
		       ease-flux active:scale-90 disabled:text-muted-foreground/30 disabled:active:scale-100"
	>
		<CaretRight size={15} weight="light" />
	</button>
</div>

{#if report.isEmpty}
	<!--
		Пустая неделя — не таблица нулей, а объяснение, откуда возьмутся
		итоги, и одна кнопка. Нули читаются как «ты ничего не сделал».
	-->
	<div class="fx-rise" style="--fx-step: 1;">
		<GlassCard bezel>
			<div class="flex flex-col items-center py-6 text-center">
				<span class="grid size-14 place-items-center rounded-2xl bg-lavender/12">
					<CalendarBlank size={26} weight="light" class="text-lavender" />
				</span>
				{#if isCurrent}
					<h2 class="mt-4 text-lg font-semibold tracking-tight">Здесь соберутся итоги недели</h2>
					<p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
						Итоги соберутся из записей — еды, привычек и трат. Одна запись в день, и к воскресенью
						здесь будет картина недели.
					</p>
					<button
						type="button"
						onclick={() => ui.openCreateSheet()}
						class="mt-5 flex items-center gap-2 rounded-full bg-lavender px-5 py-2.5 text-sm
						       font-medium text-void shadow-accent transition-transform duration-500 ease-flux
						       active:scale-[0.98]"
					>
						<Plus size={15} weight="bold" />
						Сделать запись
					</button>
				{:else}
					<h2 class="mt-4 text-lg font-semibold tracking-tight">Эта неделя прошла без записей</h2>
					<p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
						Бывает. Итоги считаются только из того, что записано, — загляните в неделю поновее.
					</p>
					<button
						type="button"
						onclick={() => {
							telegram.haptic.selection();
							start = currentStart;
						}}
						class="mt-5 rounded-full border border-line-strong px-5 py-2.5 text-sm font-medium
						       transition-transform duration-500 ease-flux active:scale-[0.98]"
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
				<p class="text-xs text-muted-foreground">Дней с записями</p>
				<p class="fx-num mt-1 text-6xl leading-none">
					{report.activeDays}<span class="text-2xl text-muted-foreground">/7</span>
				</p>

				{#if insights.length > 0}
					<ul class="mt-4 flex flex-col gap-2">
						{#each insights as insight (insight)}
							<li class="flex items-start gap-2 text-sm leading-relaxed">
								<Sparkle size={14} weight="fill" class="mt-1 shrink-0 text-lavender" />
								<span>{insight}</span>
							</li>
						{/each}
					</ul>
				{/if}

				<button
					type="button"
					onclick={() => shareWeek(report)}
					class="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-lavender py-2.5
					       text-sm font-medium text-void shadow-accent transition-transform duration-500
					       ease-flux hover:bg-lavender-hi active:scale-[0.98]"
				>
					<ShareFat size={15} weight="fill" />
					Поделиться итогами
				</button>
				<p class="mt-2 text-center text-[11px] text-muted-foreground">
					В сообщение уйдут только проценты и серии — без калорий и денег
				</p>
			</GlassCard>
		</div>

		<div class="fx-rise" style="--fx-step: 2;">
			<GlassCard tone="amber">
				<div class="mb-3 flex items-center gap-2">
					{@render sectionTitle(ForkKnife, 'Еда')}
					{@render change(comparison.calories)}
				</div>

				{#if report.nutrition.trackedDays === 0}
					<p class="text-sm text-muted-foreground">На этой неделе еду не записывали.</p>
				{:else}
					<p class="fx-num text-3xl leading-none">
						{formatNumber(Math.round(report.nutrition.avgCalories))}
						<span class="font-sans text-sm font-normal text-muted-foreground">ккал в среднем</span>
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						В цели {report.nutrition.inGoalDays} из {report.nutrition.trackedDays}
						{report.nutrition.trackedDays === 1 ? 'дня' : 'дней'} с записями
					</p>
					<div class="mt-3">
						<PeriodBars values={report.nutrition.byDay} goal={report.nutrition.goal} height={70} />
					</div>
				{/if}
			</GlassCard>
		</div>

		<div class="fx-rise" style="--fx-step: 3;">
			<GlassCard tone="mint">
				<div class="mb-3 flex items-center gap-2">
					{@render sectionTitle(CheckCircle, 'Привычки')}
					{#if previousHabitsPercent !== null && habitsPercent !== null}
						<span
							class="tabular shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-muted-foreground"
						>
							было {previousHabitsPercent} %
						</span>
					{/if}
				</div>

				{#if habitsPercent === null}
					<p class="text-sm text-muted-foreground">На неделе не было запланированных привычек.</p>
				{:else}
					<p class="fx-num text-3xl leading-none">
						{habitsPercent}<span class="text-lg text-muted-foreground"> %</span>
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						Закрыто {report.habits.done} из {report.habits.planned}
						{#if report.habits.bestStreak > 0}
							· лучшая серия {report.habits.bestStreak}&nbsp;{pluralDays(report.habits.bestStreak)}
						{/if}
					</p>
					<div class="mt-3">
						<PeriodBars values={report.habits.byDay} goal={100} height={70} />
					</div>
				{/if}
			</GlassCard>
		</div>

		<div class="fx-rise" style="--fx-step: 4;">
			<GlassCard tone="sky">
				<div class="mb-3 flex items-center gap-2">
					{@render sectionTitle(Wallet, 'Траты')}
					{@render change(comparison.spent)}
				</div>

				{#if report.finance.spent === 0}
					<p class="text-sm text-muted-foreground">Трат на этой неделе не записано.</p>
				{:else}
					<p class="fx-num text-3xl leading-none">{money(report.finance.spent)}</p>
					<p class="mt-1 text-xs text-muted-foreground">
						{isCurrent ? 'Лимит по сегодня' : 'Лимит недели'}
						{money(report.finance.budget)}
						{#if report.finance.overBudgetDays > 0}
							· сверх лимита {report.finance.overBudgetDays}&nbsp;{pluralDays(
								report.finance.overBudgetDays
							)}
						{/if}
					</p>
					{#if topCategory}
						<p class="mt-0.5 text-xs text-muted-foreground">
							Больше всего — {CATEGORY_NAMES[topCategory.category] ?? 'другое'}: {money(
								topCategory.amount
							)}
						</p>
					{/if}
					<div class="mt-3">
						<PeriodBars
							values={report.finance.byDay}
							goal={report.finance.dailyBudget}
							height={70}
							warnOverGoal
						/>
					</div>
				{/if}
			</GlassCard>
		</div>

		<div class="fx-rise grid grid-cols-2 gap-3" style="--fx-step: 5;">
			<GlassCard padding="sm">
				<div class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
					<ListChecks size={14} weight="light" class="text-lavender" />
					План
				</div>
				{#if report.plan.total === 0}
					<p class="text-sm text-muted-foreground">Дел не было</p>
				{:else}
					<p class="fx-num text-2xl leading-none">
						{report.plan.done}<span class="text-base text-muted-foreground"
							>/{report.plan.total}</span
						>
					</p>
					<p class="mt-1 text-[11px] text-muted-foreground">дел выполнено</p>
				{/if}
			</GlassCard>

			<GlassCard padding="sm">
				<div class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
					<Scales size={14} weight="light" class="text-lavender" />
					Вес
				</div>
				{#if report.weight.change === null}
					<p class="text-sm text-muted-foreground">
						{report.weight.to === null ? 'Не взвешивались' : `${formatWeight(report.weight.to)} кг`}
					</p>
				{:else}
					<p class="fx-num text-2xl leading-none">
						{report.weight.change > 0 ? '+' : report.weight.change < 0 ? '−' : ''}{formatWeight(
							Math.abs(report.weight.change)
						)}
						<span class="font-sans text-sm font-normal text-muted-foreground">кг</span>
					</p>
					<p class="mt-1 text-[11px] text-muted-foreground">
						сейчас {formatWeight(report.weight.to ?? 0)} кг
					</p>
				{/if}
			</GlassCard>
		</div>

		<!-- Один совет: из пяти не выполняется ни один. -->
		<div class="fx-rise" style="--fx-step: 6;">
			<GlassCard>
				<div class="mb-2 flex items-center gap-2">
					{@render sectionTitle(Compass, 'На следующую неделю')}
				</div>
				<p class="text-sm leading-relaxed">{advice}</p>
			</GlassCard>
		</div>
	</div>
{/if}
