<script lang="ts">
	import { ArrowUUpLeft, Flame } from 'phosphor-svelte';
	import AppIcon from '$lib/components/brand/app-icon.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { dayActivity } from '$lib/utils/analytics';
	import { addDays, dayOfWeek, getToday } from '$lib/utils/date';
	import { greeting, pluralDays } from '$lib/utils/format';

	// Вне Telegram имени нет — подставляем нейтральное, чтобы экран
	// не выглядел сломанным во время локальной разработки.
	const name = $derived(telegram.user?.first_name ?? 'Гость');

	const streak = $derived(plannerStore.currentStreak);

	/**
	 * Дашборд показывает выбранный день, а не обязательно сегодняшний:
	 * из календаря можно уйти в прошлое. Без явной отметки человек решил бы,
	 * что сегодня он съел то, что съел неделю назад.
	 */
	const today = $derived(getToday(plannerStore.doc.user.timezone));
	const isToday = $derived(plannerStore.currentDate === today);

	const MONTHS = [
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

	const selectedLabel = $derived.by(() => {
		const [, month, day] = plannerStore.currentDate.split('-').map(Number);
		return `${day} ${MONTHS[month - 1]}`;
	});

	/**
	 * Полоска недели: пн—вс текущей недели, а не выбранного дня.
	 * Иначе при просмотре прошлого понедельника полоска сама уехала бы
	 * в прошлое, и от «сегодня» на ней не осталось бы следа.
	 */
	const WEEKDAY_LETTERS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];

	const weekStart = $derived.by(() => {
		const dow = dayOfWeek(today); // 0 — воскресенье
		const mondayOffset = dow === 0 ? -6 : 1 - dow;
		return addDays(today, mondayOffset);
	});

	const weekDays = $derived(Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)));

	// Один проход по всем записям на неделю, а не dayActivity внутри #each:
	// $derived пересчитывался бы за каждую ячейку при любом изменении стора.
	const weekActivity = $derived.by(() => {
		const data = {
			foodEntries: plannerStore.foodEntries,
			financeEntries: plannerStore.financeEntries,
			habits: plannerStore.habits,
			completions: plannerStore.habitCompletions,
			planItems: plannerStore.planItems
		};
		return weekDays.map((date) => dayActivity(date, data));
	});
</script>

<header class="mb-6 flex items-center gap-3">
	<AppIcon size={44} />

	<div class="min-w-0 flex-1">
		<p class="truncate text-[11px] tracking-wide text-muted-foreground">{greeting()}</p>
		<h1 class="truncate text-lg leading-tight font-semibold tracking-tight">{name}</h1>
	</div>

	<!--
		Стрик — не эмодзи, а иконка Phosphor: в тёмном стеклянном интерфейсе
		эмодзи приезжает чужим цветом от системного шрифта и выбивается
		из палитры. Иконка наследует лаванду.
	-->
	<div
		class="flex shrink-0 items-center gap-1.5 rounded-full border border-lavender/25
		       bg-lavender/12 py-1.5 pr-3 pl-2.5"
		style="box-shadow: 0 0 22px -6px oklch(0.7022 0.1527 293.82 / 0.55);"
		title="{streak} {pluralDays(streak)} подряд"
	>
		<Flame size={15} weight="fill" class="text-lavender" />
		<span class="tabular text-xs font-semibold text-lavender">{streak}</span>
	</div>
</header>

<!--
	Лёгкая полоска без карточки: неделя — навигация, а не ещё один блок
	с данными. Точки под числом дублируют логику календаря, чтобы цвета
	раздела не разъезжались между экранами.
-->
<nav class="mb-5 grid grid-cols-7 gap-1" aria-label="Дни недели">
	{#each weekDays as date, index (date)}
		{@const activity = weekActivity[index]}
		{@const isCurrentDay = date === today}
		<a
			href="/calendar"
			onclick={() => telegram.haptic.impact('light')}
			class="flex flex-col items-center gap-1 rounded-xl py-2 transition-colors duration-400
			       ease-flux active:scale-95
			       {isCurrentDay ? 'bg-lavender text-void' : 'hover:bg-white/[0.03]'}"
		>
			<span class="text-[10px] {isCurrentDay ? 'text-void/70' : 'text-muted-foreground'}">
				{WEEKDAY_LETTERS[index]}
			</span>
			<span class="tabular text-xs font-medium {isCurrentDay ? '' : 'text-foreground'}">
				{Number(date.slice(8, 10))}
			</span>
			<span class="flex h-1 items-center gap-0.5" aria-hidden="true">
				{#if activity.calories > 0}
					<span class="size-1 rounded-full {isCurrentDay ? 'bg-void/60' : 'bg-amber'}"></span>
				{/if}
				{#if activity.habitsDone > 0}
					<span class="size-1 rounded-full {isCurrentDay ? 'bg-void/60' : 'bg-mint'}"></span>
				{/if}
				{#if activity.spent > 0}
					<span class="size-1 rounded-full {isCurrentDay ? 'bg-void/60' : 'bg-sky'}"></span>
				{/if}
			</span>
		</a>
	{/each}
</nav>

{#if !isToday}
	<button
		type="button"
		onclick={() => {
			telegram.haptic.impact('light');
			plannerStore.goToToday();
		}}
		class="mb-4 flex w-full items-center gap-2 rounded-card border border-lavender/30
		       bg-lavender/[0.08] px-3.5 py-2.5 text-left transition-transform duration-500
		       ease-flux active:scale-[0.99]"
	>
		<span class="min-w-0 flex-1 text-xs">
			Показан <span class="font-medium">{selectedLabel}</span>, а не сегодняшний день
		</span>
		<span class="flex shrink-0 items-center gap-1.5 text-xs text-lavender">
			<ArrowUUpLeft size={13} weight="light" />
			Сегодня
		</span>
	</button>
{/if}
