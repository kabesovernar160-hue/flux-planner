<script lang="ts">
	import { DotsThree, Fire } from 'phosphor-svelte';
	import HabitWeekDots from './habit-week-dots.svelte';
	import { habitIcon } from '$lib/icons/habit-icons';
	import { telegram } from '$lib/telegram';
	import type { Habit } from '$lib/types/habit';
	import { pluralDays } from '$lib/utils/format';
	import type { HabitWeekDay } from '$lib/utils/habitWeek';
	import type { StreakStats } from '$lib/utils/streak';

	type Props = {
		habit: Habit;
		checked: boolean;
		/** Запланирована ли на выбранный день. Незапланированную отметить нельзя. */
		scheduled: boolean;
		week: HabitWeekDay[];
		streak: StreakStats | null;
		ontoggle: () => void;
		onmenu: () => void;
	};

	let { habit, checked, scheduled, week, streak, ontoggle, onmenu }: Props = $props();

	const Icon = $derived(habitIcon(habit.icon));

	const FREQUENCY_LABEL: Record<Habit['frequency'], string> = {
		daily: 'Каждый день',
		weekdays: 'По будням',
		custom: 'Свои дни'
	};

	const DAY_LABELS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
	/** Порядок показа — с понедельника, как в форме. */
	const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

	const schedule = $derived.by(() => {
		if (habit.frequency !== 'custom') return FREQUENCY_LABEL[habit.frequency];
		const days = WEEK_ORDER.filter((day) => habit.targetDays?.includes(day)).map(
			(day) => DAY_LABELS[day]
		);
		return days.length > 0 ? days.join(', ') : 'Дни не выбраны';
	});

	/**
	 * Короткий «отклик» на отметку.
	 *
	 * Кнопка сразу перекрашивается, но строка через мгновение уезжает
	 * в «Сделано», и без отдельного импульса отметка теряется в движении.
	 * Класс снимается сам, чтобы повторная отметка сыграла снова.
	 */
	let popping = $state(false);
	let popTimer: ReturnType<typeof setTimeout> | null = null;

	function toggle() {
		const next = !checked;

		// Успех — только на выполнение: снятие отметки не победа,
		// и «праздничная» вибрация на нём звучала бы фальшиво.
		if (next) {
			telegram.haptic.notification('success');
			popping = true;
			if (popTimer) clearTimeout(popTimer);
			popTimer = setTimeout(() => (popping = false), 460);
		} else {
			telegram.haptic.impact('light');
		}

		ontoggle();
	}

	$effect(() => () => {
		if (popTimer) clearTimeout(popTimer);
	});
</script>

<div class="flex items-center gap-3 py-3">
	{#if scheduled || checked}
		<button
			type="button"
			role="checkbox"
			aria-checked={checked}
			aria-label={habit.name}
			onclick={toggle}
			class="grid size-11 shrink-0 place-items-center rounded-xl border
			       transition-[background-color,border-color,transform] duration-400 ease-flux active:scale-90
			       {checked ? 'border-tone bg-tone' : 'border-tone/30 bg-tone/10'}
			       {popping ? 'fx-pop' : ''}"
		>
			<Icon
				size={20}
				weight={checked ? 'fill' : 'light'}
				class="transition-colors duration-400 ease-flux {checked ? 'text-on-accent' : 'text-tone'}"
			/>
		</button>
	{:else}
		<!-- В расписании дня её нет: отмечать нечего, но видеть привычку нужно. -->
		<span
			class="grid size-11 shrink-0 place-items-center rounded-xl border border-line/70 bg-ink/[0.02]"
		>
			<Icon size={20} weight="light" class="text-muted-foreground" />
		</span>
	{/if}

	<div class="min-w-0 flex-1">
		<p
			class="truncate text-sm transition-colors duration-400 ease-flux
			       {checked ? 'text-muted-foreground' : ''}"
		>
			{habit.name}
		</p>

		<p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
			<span class="truncate">{schedule}</span>
			{#if streak && streak.current > 0}
				<span aria-hidden="true" class="text-line-strong">·</span>
				<!-- Серия в тоне раздела: это то, ради чего отмечают, и она должна быть видна. -->
				<span class="flex shrink-0 items-center gap-1 text-tone">
					<Fire size={12} weight="fill" />
					<span class="tabular">серия {streak.current} {pluralDays(streak.current)}</span>
				</span>
			{:else if streak && streak.longest > 1}
				<span aria-hidden="true" class="text-line-strong">·</span>
				<span class="tabular shrink-0">рекорд {streak.longest} {pluralDays(streak.longest)}</span>
			{/if}
		</p>

		<div class="mt-2">
			<HabitWeekDots {week} />
		</div>
	</div>

	<button
		type="button"
		onclick={() => {
			telegram.haptic.impact('light');
			onmenu();
		}}
		aria-label="Действия: {habit.name}"
		aria-haspopup="dialog"
		class="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground
		       transition-[transform,color] duration-500 ease-flux hover:text-foreground active:scale-90"
	>
		<DotsThree size={22} weight="light" />
	</button>
</div>

<style>
	/* Импульс отметки: один раз, короче 600 мс — как велит docs/design.md. */
	.fx-pop {
		animation: fx-pop 0.44s var(--fx-ease);
	}

	@keyframes fx-pop {
		0% {
			transform: scale(1);
		}
		40% {
			transform: scale(1.12);
		}
		100% {
			transform: scale(1);
		}
	}
</style>
