<script lang="ts">
	import { ArrowUUpLeft, Flame } from 'phosphor-svelte';
	import AppIcon from '$lib/components/brand/app-icon.svelte';
	import HeaderAvatar from './header-avatar.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { dayActivity } from '$lib/utils/analytics';
	import { addDays, dayOfWeek, getToday } from '$lib/utils/date';
	import { greeting, pluralDays } from '$lib/utils/format';

	// Вне Telegram имени нет — подставляем нейтральное, чтобы экран
	// не выглядел сломанным во время локальной разработки.
	const name = $derived(telegram.user?.first_name ?? 'Гость');

	/**
	 * Внутри Telegram на месте марки — сам человек: главная про его день,
	 * и своё лицо в углу говорит об этом быстрее приветствия. Вне Telegram
	 * пользователя нет, и там остаётся знак приложения.
	 */
	const user = $derived(telegram.isEmbedded ? telegram.user : null);

	const streak = $derived(plannerStore.currentStreak);

	/**
	 * Три ступени заметности серии.
	 *
	 * Ноль, горящий так же ярко, как десятидневная серия, обесценивал
	 * свечение: глаз привыкал к нему и переставал замечать настоящую серию.
	 * Поэтому ноль приглушён, короткая серия — в тоне раздела без свечения,
	 * и только с трёх дней подряд плашка начинает светиться.
	 */
	const streakLevel = $derived(streak === 0 ? 'none' : streak < 3 ? 'short' : 'long');

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

<header class="mb-4 flex items-center gap-3">
	{#if user}
		<HeaderAvatar name={user.first_name} photoUrl={user.photo_url} size={44} />
	{:else}
		<AppIcon size={44} />
	{/if}

	<div class="min-w-0 flex-1">
		<p class="truncate text-xs text-muted-foreground">{greeting()}</p>
		<h1 class="truncate text-lg leading-tight font-semibold tracking-tight">{name}</h1>
	</div>

	<!--
		Серия — это привычки, поэтому плашка мятная, а не лавандовая.
		Иконка Phosphor, а не эмодзи: эмодзи приезжает чужим цветом
		системного шрифта и выбивается из палитры.
	-->
	<div
		class="tone-mint flex shrink-0 items-center gap-1.5 rounded-full border py-1.5 pr-3 pl-2.5
		       transition-[background-color,border-color,box-shadow] duration-500 ease-flux
		       {streakLevel === 'none'
			? 'border-line/70 bg-ink/[0.02]'
			: streakLevel === 'short'
				? 'border-tone/20 bg-tone/[0.08]'
				: 'border-tone/35 bg-tone/15 shadow-[0_0_22px_-6px_var(--fx-tone)]'}"
		role="img"
		title="{streak} {pluralDays(streak)} подряд"
		aria-label="Серия: {streak} {pluralDays(streak)} подряд"
	>
		<Flame
			size={15}
			weight={streakLevel === 'none' ? 'light' : 'fill'}
			class={streakLevel === 'none' ? 'text-muted-foreground' : 'text-tone'}
		/>
		<span
			class="tabular text-xs font-semibold {streakLevel === 'none'
				? 'text-muted-foreground'
				: 'text-tone'}">{streak}</span
		>
	</div>
</header>

<!--
	Лёгкая полоска без карточки: неделя — навигация, а не ещё один блок
	с данными. Точки под числом дублируют логику календаря, чтобы цвета
	раздела не разъезжались между экранами.
-->
<nav class="mb-4 grid grid-cols-7 gap-1" aria-label="Дни недели">
	{#each weekDays as date, index (date)}
		{@const activity = weekActivity[index]}
		{@const isCurrentDay = date === today}
		<a
			href="/calendar"
			onclick={() => telegram.haptic.impact('light')}
			class="flex flex-col items-center gap-1 rounded-xl py-2 transition-colors duration-400
			       ease-flux active:scale-95
			       {isCurrentDay ? 'bg-lavender text-on-accent' : 'hover:bg-ink/[0.03]'}"
		>
			<span class="text-[11px] {isCurrentDay ? 'text-on-accent/70' : 'text-muted-foreground'}">
				{WEEKDAY_LETTERS[index]}
			</span>
			<span class="tabular text-xs font-medium {isCurrentDay ? '' : 'text-foreground'}">
				{Number(date.slice(8, 10))}
			</span>
			<span class="flex h-1 items-center gap-0.5" aria-hidden="true">
				{#if activity.calories > 0}
					<span class="size-1 rounded-full {isCurrentDay ? 'bg-on-accent/60' : 'bg-amber'}"></span>
				{/if}
				{#if activity.habitsDone > 0}
					<span class="size-1 rounded-full {isCurrentDay ? 'bg-on-accent/60' : 'bg-mint'}"></span>
				{/if}
				{#if activity.spent > 0}
					<span class="size-1 rounded-full {isCurrentDay ? 'bg-on-accent/60' : 'bg-sky'}"></span>
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
