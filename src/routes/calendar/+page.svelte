<script lang="ts">
	import {
		Camera,
		CaretLeft,
		CaretRight,
		CheckCircle,
		ForkKnife,
		ListChecks,
		Lock,
		Plus,
		Scales,
		Star,
		Trash,
		Wallet
	} from 'phosphor-svelte';
	import EmptyAction from '$lib/components/ui/empty-action.svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import HabitCheckbox from '$lib/components/ui/habit-checkbox.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import FoodList from '$lib/components/nutrition/food-list.svelte';
	import { habitIcon } from '$lib/icons/habit-icons';
	import { CATEGORY_LABELS, deleteTransaction } from '$lib/services/financeService';
	import { removeWeight } from '$lib/services/weightService';
	import { billing } from '$lib/state/billing.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { dayActivity, monthGrid, type DayActivity } from '$lib/utils/analytics';
	import { dayFullness, FULLNESS_LEVELS } from '$lib/utils/dayFullness';
	import { getToday, type DateKey } from '$lib/utils/date';
	import { historyStart } from '$lib/utils/history';
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

	/**
	 * Граница истории на бесплатном тарифе. null — ограничения нет.
	 *
	 * Дни до неё остаются в календаре видимыми, но не открываются: записи
	 * никуда не делись, и делать вид, что их не было, — неправда.
	 */
	const historyDays = $derived(billing.historyDays);
	const earliest = $derived(historyDays === null ? null : historyStart(historyDays, today));

	const isLocked = (date: DateKey) => earliest !== null && date < earliest;

	/** Есть ли в показанном месяце закрытые дни — тогда нужна и подпись. */
	const monthHasLocked = $derived(cells.some((cell) => isLocked(cell.date)));

	/**
	 * Листать назад дальше некуда.
	 *
	 * Считается по первой клетке сетки: если уже она за границей, следующий
	 * месяц целиком закрыт, и стрелка вела бы в пустоту.
	 */
	const canGoBack = $derived(earliest === null || cells[0].date >= earliest);

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

	/** Цель по калориям на день: у дня своя запись целей, иначе — из настроек. */
	function calorieGoalOn(date: DateKey): number {
		return plannerStore.doc.nutrition[date]?.calorieGoal ?? plannerStore.doc.settings.calorieGoal;
	}

	const selectedGoal = $derived(calorieGoalOn(selected));

	/**
	 * Сводка и полнота всех клеток месяца одним проходом.
	 *
	 * Раньше dayActivity звался прямо в разметке клетки, и любое изменение
	 * стора пересчитывало её по два раза на каждую из 42 клеток.
	 */
	const month = $derived(
		new Map(
			cells.map((cell) => {
				const activity = dayActivity(cell.date, data);
				return [cell.date, { activity, fullness: dayFullness(activity, calorieGoalOn(cell.date)) }];
			})
		)
	);

	/**
	 * Заливка клетки по ступеням полноты.
	 *
	 * Лаванда — цвет плана дня: «насколько день прожит по плану» — это про него.
	 * Шкала тихая, самая плотная ступень всё равно заметно светлее выбранного
	 * дня, который залит лавандой целиком, — выделение не спутать с полнотой.
	 * Классы перечислены целиком, чтобы Tailwind их нашёл.
	 */
	const FILL: string[] = [
		'',
		'bg-lavender/[0.1]',
		'bg-lavender/[0.18]',
		'bg-lavender/[0.28]',
		'bg-lavender/[0.4]'
	];

	/** Разделы, у которых в этот день что-то есть, — для точек под числом. */
	function sections(activity: DayActivity) {
		return [
			activity.calories > 0 && 'bg-amber',
			activity.habitsDone > 0 && 'bg-mint',
			activity.spent > 0 && 'bg-sky',
			activity.planTotal > 0 && 'bg-lavender'
		].filter((value): value is string => Boolean(value));
	}

	/** Направление последнего перелистывания: месяц въезжает с той стороны, куда листали. */
	let slide = $state(0);

	/**
	 * Свайп по сетке месяца.
	 *
	 * Pointer events, а не touch: одинаково работают пальцем и мышью. Жест
	 * засчитывается, только если он заметно горизонтальный, — иначе обычная
	 * вертикальная прокрутка страницы с пальцем на календаре листала бы месяцы.
	 * touch-action: pan-y оставляет вертикальную прокрутку браузеру.
	 */
	const SWIPE_MIN_PX = 48;
	let swipeStart: { x: number; y: number; id: number } | null = null;
	/** Касание, закончившееся свайпом, не должно ещё и выбрать день под пальцем. */
	let swallowClick = false;

	function onPointerDown(event: PointerEvent) {
		if (!event.isPrimary) return;
		swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
	}

	function onPointerUp(event: PointerEvent) {
		if (!swipeStart || event.pointerId !== swipeStart.id) return;
		const dx = event.clientX - swipeStart.x;
		const dy = event.clientY - swipeStart.y;
		swipeStart = null;

		if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;

		swallowClick = true;
		// Клик после pointerup приходит в том же такте; если не пришёл
		// (палец ушёл с клетки), флаг не должен съесть следующее касание.
		setTimeout(() => (swallowClick = false), 0);

		if (dx < 0) shiftMonth(1);
		else if (canGoBack) shiftMonth(-1);
		else telegram.haptic.notification('warning');
	}

	function onClickCapture(event: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		event.stopPropagation();
		event.preventDefault();
	}

	function shiftMonth(delta: number) {
		telegram.haptic.selection();
		slide = delta;
		const [year, month] = anchor.split('-').map(Number);
		const next = new Date(Date.UTC(year, month - 1 + delta, 1));
		const pad = (value: number) => String(value).padStart(2, '0');
		anchor = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`;
	}

	function pick(date: DateKey) {
		if (isLocked(date)) {
			// Тихо игнорировать нажатие нельзя: это выглядит как поломка.
			telegram.haptic.notification('warning');
			lockExplained = true;
			return;
		}

		telegram.haptic.impact('light');
		plannerStore.setDate(date);
	}

	/** Объяснение границы. Появляется после нажатия на закрытый день. */
	let lockExplained = $state(false);

	// Подписка могла кончиться при открытом старом дне: возвращаемся
	// к сегодняшнему, иначе внизу осталась бы сводка за закрытый день.
	$effect(() => {
		if (!isLocked(selected)) return;

		plannerStore.goToToday();
		anchor = today;
	});

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
					slide = today > anchor ? 1 : -1;
					anchor = today;
				}}
				class="h-10 shrink-0 rounded-full border border-line-strong px-4 text-xs
				       transition-transform duration-500 ease-flux active:scale-95"
			>
				Сегодня
			</button>
		{/if}
	{/snippet}
</PageHeader>

{#snippet chip(Icon: typeof Scales)}
	<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
		<Icon size={15} weight="regular" class="text-tone" />
	</span>
{/snippet}

<div class="flex flex-col gap-4">
	<GlassCard class="fx-rise" style="--fx-step: 0">
		<div class="mb-3 flex items-center gap-2">
			<button
				type="button"
				onclick={() => shiftMonth(-1)}
				disabled={!canGoBack}
				aria-label="Предыдущий месяц"
				class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
				       transition-transform duration-500 ease-flux active:scale-90
				       disabled:border-line disabled:text-muted-foreground/40 disabled:active:scale-100"
			>
				<CaretLeft size={15} weight="light" />
			</button>
			<h2 class="flex-1 text-center text-sm font-medium" aria-live="polite">{monthTitle}</h2>
			<button
				type="button"
				onclick={() => shiftMonth(1)}
				aria-label="Следующий месяц"
				class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
				       transition-transform duration-500 ease-flux active:scale-90"
			>
				<CaretRight size={15} weight="light" />
			</button>
		</div>

		<div class="mb-1.5 grid grid-cols-7 gap-1">
			{#each WEEKDAYS as day (day)}
				<span class="text-center text-[11px] text-muted-foreground">{day}</span>
			{/each}
		</div>

		<!--
			Сетка ловит свайп. Обработчики на обёртке, а не на клетках: жест
			начинается на одном дне и кончается на другом.
		-->
		<div
			role="presentation"
			class="touch-pan-y"
			onpointerdown={onPointerDown}
			onpointerup={onPointerUp}
			onpointercancel={() => (swipeStart = null)}
			onclickcapture={onClickCapture}
		>
			{#key anchor}
				<div class="grid grid-cols-7 gap-1 {slide !== 0 ? 'month-in' : ''}" style="--dir: {slide}">
					{#each cells as cell (cell.date)}
						{@const info = month.get(cell.date)}
						{@const isSelected = cell.date === selected}
						{@const isToday = cell.date === today}
						{@const closed = isLocked(cell.date)}
						{@const dots = info && !isSelected ? sections(info.activity) : []}
						{@const level = info && cell.inMonth && !closed ? info.fullness.level : 0}
						<button
							type="button"
							onclick={() => pick(cell.date)}
							aria-label={closed
								? `${fullLabel(cell.date)} — доступно на Pro`
								: fullLabel(cell.date)}
							aria-current={isSelected ? 'date' : undefined}
							aria-disabled={closed ? 'true' : undefined}
							class="relative flex aspect-square flex-col items-center justify-center gap-1 rounded-lg
							       text-sm transition-[background-color,color,transform] duration-400 ease-flux active:scale-90
							       {isSelected ? 'bg-lavender font-semibold text-on-accent' : FILL[level]}
							       {!isSelected && isToday
								? 'font-semibold text-lavender ring-1 ring-lavender/60 ring-inset'
								: ''}
							       {!isSelected && !isToday && cell.inMonth && !closed ? 'text-foreground' : ''}
							       {!cell.inMonth ? 'text-muted-foreground/35' : ''}
							       {closed ? 'text-muted-foreground/25 active:scale-100' : ''}"
						>
							<span class="tabular leading-none">{dayLabel(cell.date)}</span>

							<!--
								Точки остаются рядом с заливкой: заливка говорит «насколько
								полон день», точки — «чем именно». Место под них зарезервировано
								всегда, чтобы числа во всех клетках стояли на одной линии.
							-->
							<span
								aria-hidden="true"
								class="flex h-1.5 gap-[3px] {closed || !cell.inMonth ? 'opacity-40 grayscale' : ''}"
							>
								{#each dots as color (color)}
									<span class="size-1.5 rounded-full {color}"></span>
								{/each}
							</span>
						</button>
					{/each}
				</div>
			{/key}
		</div>

		<!--
			Легенда под месяцем. Без неё четыре цвета точек пришлось бы
			запоминать, а плотность заливки — угадывать.
		-->
		<div
			class="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line/60 pt-3
			       text-[11px] text-muted-foreground"
		>
			<span class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
				<span class="flex items-center gap-1"
					><span class="size-1.5 rounded-full bg-amber"></span>еда</span
				>
				<span class="flex items-center gap-1"
					><span class="size-1.5 rounded-full bg-mint"></span>привычки</span
				>
				<span class="flex items-center gap-1"
					><span class="size-1.5 rounded-full bg-sky"></span>траты</span
				>
				<span class="flex items-center gap-1"
					><span class="size-1.5 rounded-full bg-lavender"></span>план</span
				>
			</span>
			<span class="flex items-center gap-1.5" aria-label="Заливка: чем плотнее, тем полнее день">
				<span aria-hidden="true">пусто</span>
				<span aria-hidden="true" class="flex gap-0.5">
					{#each { length: FULLNESS_LEVELS }, index (index)}
						<span class="size-3 rounded-sm {FILL[index + 1]}"></span>
					{/each}
				</span>
				<span aria-hidden="true">полный день</span>
			</span>
		</div>

		{#if monthHasLocked}
			<p class="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
				<Lock size={12} weight="light" class="shrink-0" />
				Дни до {fullLabel(earliest ?? today)} — на Pro
			</p>
		{/if}

		{#if lockExplained}
			<div class="mt-3 border-t border-line pt-3">
				<p class="text-xs leading-relaxed text-muted-foreground">
					На бесплатном тарифе календарь открывает последние {historyDays} дней. Записи старше никуда
					не делись — они на устройстве и в выгрузке, и снова откроются на Pro.
				</p>
				<a
					href="/settings/plan"
					class="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-lavender py-2.5
					       text-sm font-medium text-on-accent shadow-accent transition-transform duration-500
					       ease-flux active:scale-[0.98]"
				>
					<Star size={15} weight="fill" />
					Посмотреть тариф
				</a>
			</div>
		{/if}
	</GlassCard>

	<!--
		Итог дня — в тонах разделов: калории янтарные, привычки мятные, траты
		голубые. Цифры узнаются по цвету ещё до подписи, как и на главной.
	-->
	<GlassCard class="fx-rise" style="--fx-step: 1">
		<h2 class="mb-3 text-sm font-medium">Итог дня</h2>

		<div class="grid grid-cols-3 gap-2">
			<div class="tone-amber rounded-xl border border-tone/20 bg-tone/[0.06] px-2.5 py-2.5">
				<p class="text-[11px] text-muted-foreground">Калории</p>
				<p class="tabular mt-1 truncate text-sm font-medium text-tone">
					{formatNumber(summary.calories)}
				</p>
				<p class="tabular truncate text-[11px] text-muted-foreground">
					из {formatNumber(selectedGoal)}
				</p>
			</div>
			<div class="tone-mint rounded-xl border border-tone/20 bg-tone/[0.06] px-2.5 py-2.5">
				<p class="text-[11px] text-muted-foreground">Привычки</p>
				<p class="tabular mt-1 truncate text-sm font-medium text-tone">
					{summary.habitsPlanned === 0 ? '—' : `${summary.habitsDone} из ${summary.habitsPlanned}`}
				</p>
				<p class="truncate text-[11px] text-muted-foreground">
					{summary.habitsPlanned === 0
						? 'нет в плане'
						: summary.habitsDone >= summary.habitsPlanned
							? 'все закрыты'
							: 'отмечено'}
				</p>
			</div>
			<div class="tone-sky rounded-xl border border-tone/20 bg-tone/[0.06] px-2.5 py-2.5">
				<p class="text-[11px] text-muted-foreground">Траты</p>
				<p class="tabular mt-1 truncate text-sm font-medium text-tone">{money(summary.spent)}</p>
				<p class="truncate text-[11px] text-muted-foreground">
					{dayFinance.length === 0 ? 'нет записей' : 'за день'}
				</p>
			</div>
		</div>
	</GlassCard>

	{#if dayPlan.length > 0}
		<GlassCard class="fx-rise" style="--fx-step: 2">
			<div class="mb-3 flex items-center gap-2">
				{@render chip(ListChecks)}
				<h2 class="flex-1 text-sm font-medium">План</h2>
				<span class="tabular text-xs text-muted-foreground">
					{summary.planDone} из {summary.planTotal}
				</span>
			</div>
			<ul class="flex flex-col gap-1.5">
				{#each dayPlan as item (item.id)}
					<li class="flex items-center gap-3 rounded-xl border border-line/70 bg-ink/[0.02] p-3">
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

	<GlassCard class="fx-rise" style="--fx-step: 2">
		<!--
			Вес правится за любой день, как и всё остальное: опечатку во вчерашнем
			взвешивании иначе нельзя было бы исправить вовсе — сегодняшняя запись
			её не заменяет. Вес — лавандовый, как и везде.
		-->
		<div class="mb-3 flex items-center gap-2">
			{@render chip(Scales)}
			<h2 class="flex-1 text-sm font-medium">Вес</h2>
			{#if dayWeight}
				<span class="tabular text-sm font-medium text-lavender">
					{formatWeight(dayWeight.weightKg)} кг
				</span>
			{/if}
		</div>

		<div class="flex gap-2">
			<button
				type="button"
				onclick={() => ui.openWeightSheet()}
				class="h-10 flex-1 rounded-full border border-line-strong text-xs font-medium
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
					<Trash size={14} weight="light" />
				</button>
			{/if}
		</div>
	</GlassCard>

	<GlassCard tone="amber" class="fx-rise" style="--fx-step: 3">
		<div class="mb-3 flex items-center gap-2">
			{@render chip(ForkKnife)}
			<h2 class="flex-1 text-sm font-medium">Еда</h2>
			{#if summary.calories > 0}
				<span class="tabular text-xs text-muted-foreground">
					{formatNumber(summary.calories)} ккал
				</span>
			{/if}
		</div>
		{#if dayFoods.length === 0}
			<!-- Запись уходит в выбранный день: шторки пишут в currentDate стора. -->
			<EmptyAction
				text="С записями о еде у дня появится отметка, и пропуски станут видны."
				label="Добавить еду"
				icon={Camera}
				tone="amber"
				onclick={() => ui.openFoodSheet()}
			/>
		{:else}
			<!--
				Тот же список, что и на главной: правка и удаление записи за любой день
				работают одинаково, отдельной «истории только для чтения» нет.
			-->
			<FoodList entries={dayFoods} />
		{/if}
	</GlassCard>

	{#if plannerStore.habits.length === 0}
		<!--
			Без единой привычки карточка раньше просто пропадала, и календарь
			не подсказывал, что отметки дней тоже живут здесь.
		-->
		<GlassCard tone="mint" class="fx-rise" style="--fx-step: 4">
			<div class="mb-3 flex items-center gap-2">
				{@render chip(CheckCircle)}
				<h2 class="flex-1 text-sm font-medium">Привычки</h2>
			</div>
			<EmptyAction
				tone="mint"
				text="Отметки привычек сложатся здесь в серии по дням."
				label="Добавить привычку"
				icon={Plus}
				onclick={() => ui.openHabitSheet()}
			/>
		</GlassCard>
	{:else if dayHabits.length > 0}
		<GlassCard tone="mint" class="fx-rise" style="--fx-step: 4">
			<div class="mb-2 flex items-center gap-2">
				{@render chip(CheckCircle)}
				<h2 class="flex-1 text-sm font-medium">Привычки</h2>
				<span class="tabular text-xs text-muted-foreground">
					{summary.habitsDone} из {summary.habitsPlanned}
				</span>
			</div>
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

	<GlassCard tone="sky" class="fx-rise" style="--fx-step: 5">
		<div class="mb-3 flex items-center gap-2">
			{@render chip(Wallet)}
			<h2 class="flex-1 text-sm font-medium">Траты и доходы</h2>
		</div>

		{#if dayFinance.length === 0}
			<EmptyAction
				text="Траты за день сложатся в баланс и покажут, где уходит лишнее."
				label="Записать трату"
				icon={Wallet}
				tone="sky"
				onclick={() => ui.openFinanceSheet(undefined, 'expense')}
			/>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each dayFinance as entry (entry.id)}
					<li class="flex items-center gap-3 rounded-xl border border-line/70 bg-ink/[0.02] p-3">
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
							class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
							       text-muted-foreground transition-transform duration-500 ease-flux active:scale-90"
						>
							<Trash size={14} weight="light" />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</GlassCard>
</div>

<style>
	/*
		Месяц въезжает с той стороны, куда листали: так понятно, что это
		соседний месяц, а не перерисовка того же. Только transform и opacity.
	*/
	.month-in {
		animation: month-in 0.36s var(--fx-ease);
	}

	@keyframes month-in {
		from {
			opacity: 0;
			transform: translate3d(calc(var(--dir) * 28px), 0, 0);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
	}
</style>
