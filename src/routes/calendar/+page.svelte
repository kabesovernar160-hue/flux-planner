<script lang="ts">
	import { CaretLeft, CaretRight, Scales, Trash } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import HabitCheckbox from '$lib/components/ui/habit-checkbox.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import FoodList from '$lib/components/nutrition/food-list.svelte';
	import { habitIcon } from '$lib/icons/habit-icons';
	import { CATEGORY_LABELS, deleteTransaction } from '$lib/services/financeService';
	import { removeWeight } from '$lib/services/weightService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { dayActivity, monthGrid } from '$lib/utils/analytics';
	import { getToday, type DateKey } from '$lib/utils/date';
	import { formatMoney, formatNumber, formatWeight } from '$lib/utils/format';
	import { scheduledHabits } from '$lib/utils/habitFrequency';

	const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
	const MONTHS = [
		'Январь',
		'Февраль',
		'Март',
		'Апрель',
		'Май',
		'Июнь',
		'Июль',
		'Август',
		'Сентябрь',
		'Октябрь',
		'Ноябрь',
		'Декабрь'
	];

	/**
	 * Месяц на экране отделён от выбранного дня.
	 *
	 * Иначе пролистывание месяцев меняло бы день, за который показывается
	 * сводка, — человек просто листает календарь, а у него под ногами
	 * переписывается дневник.
	 */
	let anchor = $state<DateKey>(plannerStore.currentDate);

	const selected = $derived(plannerStore.currentDate);
	const today = $derived(getToday(plannerStore.doc.user.timezone));

	const cells = $derived(monthGrid(anchor));

	const dayWeight = $derived(plannerStore.getWeight(selected));

	const currency = $derived(plannerStore.doc.settings.currency);
	const locale = $derived(plannerStore.doc.settings.locale);
	const money = (value: number) => formatMoney(value, currency, locale);

	const data = $derived({
		foodEntries: plannerStore.foodEntries,
		financeEntries: plannerStore.financeEntries,
		habits: plannerStore.habits,
		completions: plannerStore.habitCompletions,
		planItems: plannerStore.planItems
	});

	const monthTitle = $derived.by(() => {
		const [year, month] = anchor.split('-').map(Number);
		return `${MONTHS[month - 1]} ${year}`;
	});

	const dayPlan = $derived(
		plannerStore.planItems
			.filter((item) => item.date === selected)
			.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
	);
	const dayFoods = $derived(plannerStore.foodEntries.filter((entry) => entry.date === selected));
	const dayHabits = $derived(scheduledHabits(plannerStore.habits, selected));
	const dayFinance = $derived(
		plannerStore.financeEntries.filter((entry) => entry.date === selected)
	);
	const summary = $derived(dayActivity(selected, data));

	function shiftMonth(delta: number) {
		telegram.haptic.selection();
		const [year, month] = anchor.split('-').map(Number);
		const next = new Date(Date.UTC(year, month - 1 + delta, 1));
		const pad = (value: number) => String(value).padStart(2, '0');
		anchor = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`;
	}

	function pick(date: DateKey) {
		telegram.haptic.impact('light');
		plannerStore.setDate(date);
	}

	function dayLabel(date: DateKey): string {
		return String(Number(date.slice(8, 10)));
	}

	/**
	 * Родительный падеж для даты: «19 сентября», а не «19 сентябрь».
	 * В заголовке месяца нужен именительный, поэтому списка два.
	 */
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

	function fullLabel(date: DateKey): string {
		const [year, month, day] = date.split('-').map(Number);
		return `${day} ${MONTHS_OF[month - 1]} ${year}`;
	}
</script>

<PageHeader title="Календарь" subtitle={fullLabel(selected)}>
	{#snippet action()}
		{#if selected !== today}
			<button
				type="button"
				onclick={() => {
					telegram.haptic.impact('light');
					plannerStore.goToToday();
					anchor = today;
				}}
				class="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-xs
				       transition-transform duration-500 ease-flux active:scale-95"
			>
				Сегодня
			</button>
		{/if}
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-4">
	<GlassCard>
		<div class="mb-3 flex items-center gap-2">
			<button
				type="button"
				onclick={() => shiftMonth(-1)}
				aria-label="Предыдущий месяц"
				class="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong
				       transition-transform duration-500 ease-flux active:scale-90"
			>
				<CaretLeft size={14} weight="light" />
			</button>
			<h2 class="flex-1 text-center text-sm font-medium">{monthTitle}</h2>
			<button
				type="button"
				onclick={() => shiftMonth(1)}
				aria-label="Следующий месяц"
				class="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong
				       transition-transform duration-500 ease-flux active:scale-90"
			>
				<CaretRight size={14} weight="light" />
			</button>
		</div>

		<div class="mb-1.5 grid grid-cols-7 gap-1">
			{#each WEEKDAYS as day (day)}
				<span class="text-center text-[10px] text-muted-foreground">{day}</span>
			{/each}
		</div>

		<div class="grid grid-cols-7 gap-1">
			{#each cells as cell (cell.date)}
				{@const activity = dayActivity(cell.date, data)}
				{@const isSelected = cell.date === selected}
				<button
					type="button"
					onclick={() => pick(cell.date)}
					aria-label={fullLabel(cell.date)}
					aria-current={isSelected ? 'date' : undefined}
					class="relative grid aspect-square place-items-center rounded-lg text-xs
					       transition-[background-color,color,transform] duration-400 ease-flux active:scale-90
					       {isSelected ? 'bg-lavender font-semibold text-void' : ''}
					       {!isSelected && cell.date === today ? 'border border-lavender/50' : ''}
					       {!isSelected && cell.inMonth ? 'text-foreground' : ''}
					       {!cell.inMonth ? 'text-muted-foreground/35' : ''}"
				>
					{dayLabel(cell.date)}

					<!--
						Точка под числом — единственный маркер активности. Раскрашивать
						сам день значило бы соревноваться с выделением выбранной даты.
					-->
					{#if activity.hasAnything && !isSelected}
						<span class="absolute bottom-1 size-1 rounded-full bg-lavender/70"></span>
					{/if}
				</button>
			{/each}
		</div>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-3 text-sm font-medium">{fullLabel(selected)}</h2>

		<div class="grid grid-cols-3 gap-2">
			<div class="rounded-xl border border-line/70 bg-white/[0.02] px-2 py-2.5 text-center">
				<p class="text-[11px] text-muted-foreground">Калории</p>
				<p class="tabular mt-0.5 text-sm font-medium">{formatNumber(summary.calories)}</p>
			</div>
			<div class="rounded-xl border border-line/70 bg-white/[0.02] px-2 py-2.5 text-center">
				<p class="text-[11px] text-muted-foreground">Привычки</p>
				<p class="tabular mt-0.5 text-sm font-medium">
					{summary.habitsDone}/{summary.habitsPlanned}
				</p>
			</div>
			<div class="rounded-xl border border-line/70 bg-white/[0.02] px-2 py-2.5 text-center">
				<p class="text-[11px] text-muted-foreground">Траты</p>
				<p class="tabular mt-0.5 text-sm font-medium">{money(summary.spent)}</p>
			</div>
		</div>
	</GlassCard>

	{#if dayPlan.length > 0}
		<GlassCard>
			<h2 class="mb-3 text-sm font-medium">План</h2>
			<ul class="flex flex-col gap-1.5">
				{#each dayPlan as item (item.id)}
					<li class="flex items-center gap-3 rounded-xl border border-line/70 bg-white/[0.02] p-3">
						<button
							type="button"
							onclick={() => {
								telegram.haptic.impact('light');
								plannerStore.togglePlanItem(item.id);
							}}
							role="checkbox"
							aria-checked={item.done}
							aria-label={item.title}
							class="grid size-5 shrink-0 place-items-center rounded-md border
							       transition-[background-color,border-color] duration-400 ease-flux
							       {item.done ? 'border-lavender bg-lavender' : 'border-line-strong'}"
						></button>
						<span
							class="min-w-0 flex-1 truncate text-sm {item.done
								? 'text-muted-foreground line-through'
								: ''}"
						>
							{item.title}
						</span>
						{#if item.time}
							<span class="tabular shrink-0 text-xs text-muted-foreground">{item.time}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</GlassCard>
	{/if}

	<GlassCard>
		<!--
			Вес правится за любой день, как и всё остальное: опечатку во вчерашнем
			взвешивании иначе нельзя было бы исправить вовсе — сегодняшняя запись
			её не заменяет.
		-->
		<div class="mb-2 flex items-center gap-2">
			<Scales size={15} weight="light" class="text-lavender" />
			<h2 class="flex-1 text-sm font-medium">Вес</h2>
			{#if dayWeight}
				<span class="tabular text-sm font-medium">{formatWeight(dayWeight.weightKg)} кг</span>
			{/if}
		</div>

		<div class="flex gap-2">
			<button
				type="button"
				onclick={() => ui.openWeightSheet()}
				class="flex-1 rounded-full border border-line-strong py-2.5 text-xs font-medium
				       transition-[transform,border-color] duration-500 ease-flux
				       hover:border-lavender/60 active:scale-[0.98]"
			>
				{dayWeight ? 'Изменить' : 'Записать вес'}
			</button>
			{#if dayWeight}
				<button
					type="button"
					onclick={() => {
						telegram.haptic.impact('medium');
						removeWeight(selected);
					}}
					aria-label="Удалить взвешивание"
					class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
					       text-muted-foreground transition-transform duration-500 ease-flux active:scale-90"
				>
					<Trash size={13} weight="light" />
				</button>
			{/if}
		</div>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-3 text-sm font-medium">Еда</h2>
		<!--
			Тот же список, что и на главной: правка и удаление записи за любой день
			работают одинаково, отдельной «истории только для чтения» нет.
		-->
		<FoodList entries={dayFoods} empty="За этот день записей о еде нет." />
	</GlassCard>

	{#if dayHabits.length > 0}
		<GlassCard>
			<h2 class="mb-2 text-sm font-medium">Привычки</h2>
			<div class="flex flex-col gap-0.5">
				{#each dayHabits as habit (habit.id)}
					<HabitCheckbox
						label={habit.name}
						checked={plannerStore.isHabitCompleted(habit.id, selected)}
						icon={habitIcon(habit.icon)}
						onchange={() => plannerStore.toggleHabit(habit.id, selected)}
					/>
				{/each}
			</div>
		</GlassCard>
	{/if}

	<GlassCard>
		<h2 class="mb-3 text-sm font-medium">Траты и доходы</h2>

		{#if dayFinance.length === 0}
			<p class="py-1 text-sm text-muted-foreground">За этот день записей нет.</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each dayFinance as entry (entry.id)}
					<li class="flex items-center gap-3 rounded-xl border border-line/70 bg-white/[0.02] p-3">
						<!--
							Тап по записи открывает ту же форму, что и создание: правка
							суммы или категории не должна требовать «удалить и завести заново».
						-->
						<button
							type="button"
							onclick={() => {
								telegram.haptic.impact('light');
								ui.editFinanceEntry(entry.id);
							}}
							class="flex min-w-0 flex-1 items-center gap-3 text-left"
						>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm">
									{entry.note || CATEGORY_LABELS[entry.category]}
								</span>
								<span class="block text-xs text-muted-foreground">
									{CATEGORY_LABELS[entry.category]}
								</span>
							</span>
							<span
								class="tabular shrink-0 text-sm font-medium
								       {entry.type === 'income' ? 'text-success' : ''}"
							>
								{entry.type === 'income' ? '+' : '−'}{money(entry.amount)}
							</span>
						</button>
						<button
							type="button"
							onclick={() => {
								telegram.haptic.impact('medium');
								deleteTransaction(entry.id);
							}}
							aria-label="Удалить запись"
							class="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong
							       text-muted-foreground transition-transform duration-500 ease-flux active:scale-90"
						>
							<Trash size={13} weight="light" />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</GlassCard>
</div>
