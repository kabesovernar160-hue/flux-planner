<script lang="ts">
	import { CaretRight, Check, CheckCircle, Plus } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { habitIcon } from '$lib/icons/habit-icons';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';

	const habits = $derived(plannerStore.todayHabits);
	const done = $derived(plannerStore.completedHabits.length);
	const allDone = $derived(habits.length > 0 && done === habits.length);

	/** На дашборде показываем первые четыре — ровно сетка 2×2, остальные на своём экране. */
	const featured = $derived(habits.slice(0, 4));
	const hidden = $derived(habits.length - featured.length);

	/**
	 * Короткая вспышка на отмеченном чипе.
	 *
	 * Цвет чипа меняется и без неё, но смена заливки — это состояние,
	 * а не отдача: в пальце уже хаптика, глазу нужен такой же короткий
	 * ответ на месте нажатия. Только при отметке — снятие флажка
	 * не повод для праздника.
	 */
	let flashing = $state<string | null>(null);

	function toggle(id: string) {
		const next = plannerStore.toggleHabit(id);
		if (next) {
			telegram.haptic.notification('success');
			// Сброс и повтор в следующем кадре: иначе быстрая отметка второго
			// чипа после первого не перезапустила бы анимацию.
			flashing = null;
			requestAnimationFrame(() => (flashing = id));
		} else {
			telegram.haptic.impact('light');
			if (flashing === id) flashing = null;
		}
	}
</script>

<GlassCard tone="mint" id="habits-card">
	<div class="mb-3 flex items-center gap-2">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<CheckCircle size={15} weight="regular" class="text-tone" />
		</span>
		<h2 class="flex-1 text-sm font-medium">Привычки</h2>

		{#if allDone}
			<!--
				Спокойная отметка вместо счётчика «6 из 6»: закрытый день —
				другое состояние, а не ещё одна цифра. Появляется один раз,
				без пульсации: экран в покое не шевелится.
			-->
			<span class="habits-done flex items-center gap-1.5 text-xs font-medium text-tone">
				<span class="grid size-5 place-items-center rounded-full bg-tone/15">
					<Check size={11} weight="bold" />
				</span>
				Все на сегодня
			</span>
		{:else if habits.length > 0}
			<span class="tabular text-sm font-semibold">
				<!-- Неразрывный пробел: обычный схлопывается на границе тега, и счётчик слипается в «4из 6». -->
				{done}<span class="font-normal text-muted-foreground">&nbsp;из {habits.length}</span>
			</span>
		{/if}
	</div>

	{#if habits.length === 0}
		<p class="text-sm leading-relaxed text-muted-foreground">
			На сегодня привычек нет. Добавьте первую — она появится здесь.
		</p>
		<button
			type="button"
			onclick={() => ui.openHabitSheet()}
			class="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-tone py-2.5
			       text-xs font-medium text-void transition-transform duration-500 ease-flux
			       active:scale-[0.98]"
		>
			<Plus size={13} weight="bold" />
			Новая привычка
		</button>
	{:else}
		<!--
			Чипы вместо списка со строками-флажками: тон заливки — то же mint,
			что и весь раздел, поэтому выполненная привычка не спорит с картой.
		-->
		<div class="grid grid-cols-2 gap-2">
			{#each featured as habit (habit.id)}
				{@const Icon = habitIcon(habit.icon)}
				{@const checked = plannerStore.isHabitCompleted(habit.id)}
				<button
					type="button"
					onclick={() => toggle(habit.id)}
					onanimationend={() => {
						if (flashing === habit.id) flashing = null;
					}}
					role="checkbox"
					aria-checked={checked}
					aria-label={habit.name}
					class="flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2.5 text-left
					       transition-[background-color,border-color,scale] duration-400 ease-flux active:scale-[0.97]
					       {checked ? 'border-tone/50 bg-tone/15' : 'border-line/70 bg-white/[0.02]'}
					       {flashing === habit.id ? 'habit-flash' : ''}"
				>
					<Icon
						size={16}
						weight={checked ? 'fill' : 'light'}
						class="shrink-0 {checked ? 'text-tone' : 'text-muted-foreground'}"
					/>
					<span
						class="min-w-0 flex-1 truncate text-xs font-medium
					             {checked ? '' : 'text-muted-foreground'}"
					>
						{habit.name}
					</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="mt-3 flex items-center gap-3">
		<a
			href="/habits"
			class="flex flex-1 items-center gap-1 text-xs text-muted-foreground
			       transition-colors duration-400 ease-flux hover:text-foreground"
		>
			Все привычки
			{#if hidden > 0}
				<span class="tabular text-muted-foreground/70">· ещё {hidden}</span>
			{/if}
			<CaretRight size={12} weight="light" />
		</a>

		{#if plannerStore.longestStreak > 0}
			<span class="tabular shrink-0 text-xs text-muted-foreground">
				Лучшая серия: <span class="text-foreground">{plannerStore.longestStreak}</span>
			</span>
		{/if}
	</div>
</GlassCard>

<style>
	/*
	 * Вспышка — кольцо тона расходится от кромки и гаснет.
	 * box-shadow здесь допустим: анимация короткая и одна, а не фоновая.
	 * Длительность 500 мс — в пределах шкалы движения docs/design.md.
	 */
	@keyframes habit-flash {
		0% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--fx-tone) 55%, transparent);
			transform: scale(0.97);
		}

		40% {
			transform: scale(1.02);
		}

		100% {
			box-shadow: 0 0 0 10px color-mix(in oklch, var(--fx-tone) 0%, transparent);
			transform: scale(1);
		}
	}

	.habit-flash {
		animation: habit-flash 0.5s var(--fx-ease);
	}

	/* Отметка «все на сегодня» въезжает один раз и остаётся неподвижной. */
	@keyframes habits-done {
		from {
			opacity: 0;
			transform: translate3d(4px, 0, 0) scale(0.96);
		}

		to {
			opacity: 1;
			transform: none;
		}
	}

	.habits-done {
		animation: habits-done 0.44s var(--fx-ease) backwards;
	}
</style>
