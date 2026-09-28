<script lang="ts">
	import { flip } from 'svelte/animate';
	import { crossfade, fade } from 'svelte/transition';
	import { Archive, ArrowCounterClockwise, Plus } from 'phosphor-svelte';
	import HabitActionsSheet from '$lib/components/habits/habit-actions-sheet.svelte';
	import HabitDaySummary from '$lib/components/habits/habit-day-summary.svelte';
	import HabitRow from '$lib/components/habits/habit-row.svelte';
	import EmptyAction from '$lib/components/ui/empty-action.svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { habitIcon } from '$lib/icons/habit-icons';
	import { getHabitStreak, restoreHabit } from '$lib/services/habitService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import type { Habit } from '$lib/types/habit';
	import { getToday } from '$lib/utils/date';
	import { fluxEase } from '$lib/utils/easing';
	import { isScheduledOn } from '$lib/utils/habitFrequency';
	import { groupHabitsForDay, habitWeekHistory } from '$lib/utils/habitWeek';

	const date = $derived(plannerStore.currentDate);
	const today = $derived(getToday(plannerStore.doc.user.timezone));

	const active = $derived(plannerStore.habits.filter((habit) => !habit.archived));
	const archived = $derived(plannerStore.habits.filter((habit) => habit.archived));

	const raw = $derived(groupHabitsForDay(active, plannerStore.habitCompletions, date));

	/**
	 * Только что отмеченные привычки ненадолго остаются на месте.
	 *
	 * Если строка улетает в «Сделано» в тот же кадр, человек не видит,
	 * как кнопка залилась: отметка теряется в движении. Короткая пауза даёт
	 * увидеть результат касания, а уже потом показывает, куда строка ушла.
	 * В данных отметка записана сразу — задерживается только раскладка.
	 */
	const HOLD_MS = 450;
	let holding = $state<string[]>([]);
	const holdTimers = new Set<ReturnType<typeof setTimeout>>();

	function toggle(habitId: string) {
		const next = plannerStore.toggleHabit(habitId, date);
		if (!next) return;

		holding = [...holding, habitId];
		const timer = setTimeout(() => {
			holding = holding.filter((id) => id !== habitId);
			holdTimers.delete(timer);
		}, HOLD_MS);
		holdTimers.add(timer);
	}

	$effect(() => () => {
		for (const timer of holdTimers) clearTimeout(timer);
	});

	const groups = $derived.by(() => {
		if (holding.length === 0) return raw;
		const held = (habit: Habit) => holding.includes(habit.id) && raw.done.includes(habit);
		return {
			// Порядок исходный: удержанная строка стоит там же, где стояла.
			todo: active.filter((habit) => raw.todo.includes(habit) || held(habit)),
			done: raw.done.filter((habit) => !held(habit)),
			off: raw.off
		};
	});

	/** Сводка считает запланированные и отмеченные: отметка вне расписания — тоже работа. */
	const planned = $derived(raw.todo.length + raw.done.length);

	const streaks = $derived(
		new Map(active.map((habit) => [habit.id, getHabitStreak(habit.id, date)]))
	);

	const weeks = $derived(
		new Map(
			active.map((habit) => [
				habit.id,
				habitWeekHistory(habit, plannerStore.habitCompletions, date)
			])
		)
	);

	const best = $derived.by(() => {
		let top: { days: number; name: string } | null = null;
		for (const habit of active) {
			const days = streaks.get(habit.id)?.current ?? 0;
			if (days > 0 && (!top || days > top.days)) top = { days, name: habit.name };
		}
		return top;
	});

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

	/**
	 * Экран отмечает выбранный в календаре день. Подписывать его «сегодня»,
	 * когда выбран вчерашний, значило бы отмечать не тот день и не знать об этом.
	 */
	const dayLabel = $derived.by(() => {
		if (date === today) return 'Сегодня';
		const [, month, day] = date.split('-').map(Number);
		return `${day} ${MONTHS_OF[month - 1]}`;
	});

	function countLabel(n: number): string {
		const mod10 = n % 10;
		const mod100 = n % 100;
		if (mod10 === 1 && mod100 !== 11) return `${n} активная`;
		if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} активные`;
		return `${n} активных`;
	}

	/** Меню действий. Хранится id, а не объект: привычку могли удалить с другого устройства. */
	let menuId = $state<string | null>(null);
	const menuHabit = $derived(menuId ? (active.find((habit) => habit.id === menuId) ?? null) : null);

	/**
	 * Строка уезжает из «Осталось» в «Сделано» полётом, а не исчезает.
	 *
	 * Без этого после касания строка пропадает прямо из-под пальца, и
	 * неясно, отметилась привычка или удалилась. Полёт показывает, куда она
	 * делась. Соседи сдвигаются через flip той же кривой.
	 */
	const [send, receive] = crossfade({
		duration: 420,
		easing: fluxEase,
		fallback: (node) => fade(node, { duration: 240, easing: fluxEase })
	});

	const MOTION = { duration: 420, easing: fluxEase };
</script>

<PageHeader
	title="Привычки"
	subtitle={active.length > 0 ? countLabel(active.length) : 'Пока ни одной'}
	back="/"
>
	{#snippet action()}
		<!--
			Кнопка раздела — в его тоне и без лавандового свечения: shadow-accent
			по правилам только у лавандовых кнопок. Тень берёт тот же мятный тон.
		-->
		<button
			type="button"
			onclick={() => ui.openHabitSheet()}
			aria-label="Новая привычка"
			class="tone-mint grid size-10 shrink-0 place-items-center rounded-full bg-tone text-void
			       shadow-[0_12px_32px_-16px_var(--fx-tone)] transition-transform duration-500 ease-flux
			       active:scale-90"
		>
			<Plus size={18} weight="bold" />
		</button>
	{/snippet}
</PageHeader>

{#snippet list(items: Habit[])}
	<ul class="-my-3 divide-y divide-line/60">
		{#each items as habit (habit.id)}
			<li
				in:receive={{ key: habit.id }}
				out:send={{ key: habit.id }}
				animate:flip={MOTION}
				class="relative"
			>
				<HabitRow
					{habit}
					checked={raw.done.includes(habit)}
					scheduled={isScheduledOn(habit, date)}
					week={weeks.get(habit.id) ?? []}
					streak={streaks.get(habit.id) ?? null}
					ontoggle={() => toggle(habit.id)}
					onmenu={() => (menuId = habit.id)}
				/>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet sectionTitle(title: string, count: number)}
	<h2 class="mb-1 flex items-baseline gap-2 text-sm font-medium">
		<span class="flex-1">{title}</span>
		<span class="tabular text-xs font-normal text-muted-foreground">{count}</span>
	</h2>
{/snippet}

<div class="tone-mint flex flex-col gap-4">
	{#if active.length === 0}
		<GlassCard class="fx-rise">
			<EmptyAction
				text="Отмеченные дни складываются в серии — видно, что держится, а что нет."
				label="Добавить привычку"
				icon={Plus}
				onclick={() => ui.openHabitSheet()}
			/>
		</GlassCard>
	{:else}
		<HabitDaySummary
			done={raw.done.length}
			{planned}
			{dayLabel}
			{best}
			class="fx-rise"
			style="--fx-step: 0"
		/>

		{#if groups.todo.length > 0}
			<GlassCard class="fx-rise" style="--fx-step: 1">
				{@render sectionTitle('Осталось', groups.todo.length)}
				<div class="pt-3">{@render list(groups.todo)}</div>
			</GlassCard>
		{/if}

		{#if groups.done.length > 0}
			<GlassCard class="fx-rise" style="--fx-step: 2">
				{@render sectionTitle('Сделано', groups.done.length)}
				<div class="pt-3">{@render list(groups.done)}</div>
			</GlassCard>
		{/if}

		{#if groups.off.length > 0}
			<!--
				Незапланированные — отдельно и тише: сегодня от них ничего не
				ждут, но настроить или убрать их по-прежнему нужно отсюда.
			-->
			<GlassCard class="fx-rise opacity-75" style="--fx-step: 3">
				<h2 class="mb-1 flex items-baseline gap-2 text-sm font-medium text-muted-foreground">
					<span class="flex-1">Не по расписанию</span>
					<span class="tabular text-xs font-normal">{groups.off.length}</span>
				</h2>
				<div class="pt-3">{@render list(groups.off)}</div>
			</GlassCard>
		{/if}

		<!-- Легенда к точкам: без неё пустая и бледная точка неразличимы по смыслу. -->
		<p
			class="fx-rise flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 text-[11px] text-muted-foreground"
			style="--fx-step: 4"
		>
			<span>Последние 7 дней:</span>
			<span class="flex items-center gap-1"
				><span class="size-2 rounded-full bg-tone"></span>сделано</span
			>
			<span class="flex items-center gap-1"
				><span class="size-2 rounded-full bg-tone/18"></span>пропуск</span
			>
			<span class="flex items-center gap-1"
				><span class="grid size-2 place-items-center"
					><span class="size-1 rounded-full bg-muted-foreground/30"></span></span
				>не в расписании</span
			>
		</p>
	{/if}

	{#if archived.length > 0}
		<GlassCard class="fx-rise" style="--fx-step: 5">
			<h2 class="mb-3 flex items-center gap-2 text-sm font-medium">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.05]">
					<Archive size={15} weight="regular" class="text-muted-foreground" />
				</span>
				<span class="flex-1">Архив</span>
				<span class="tabular text-xs font-normal text-muted-foreground">{archived.length}</span>
			</h2>

			<!--
				Архив — это состояние, а не удаление: привычка не мешает на главной,
				но её история и серии остаются.
			-->
			<ul class="flex flex-col gap-1.5">
				{#each archived as habit (habit.id)}
					{@const Icon = habitIcon(habit.icon)}
					<li
						in:fade={MOTION}
						class="flex items-center gap-3 rounded-xl border border-line/70 py-1.5 pr-1.5 pl-3"
					>
						<Icon size={17} weight="light" class="shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{habit.name}</span>
						<button
							type="button"
							onclick={() => {
								telegram.haptic.impact('light');
								restoreHabit(habit.id);
							}}
							class="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line-strong
							       px-3.5 text-xs transition-transform duration-500 ease-flux active:scale-95"
						>
							<ArrowCounterClockwise size={13} weight="light" />
							Вернуть
						</button>
					</li>
				{/each}
			</ul>
		</GlassCard>
	{/if}
</div>

<HabitActionsSheet habit={menuHabit} onclose={() => (menuId = null)} />
