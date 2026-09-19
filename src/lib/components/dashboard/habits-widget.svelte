<script lang="ts">
	import { CaretRight, CheckCircle } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import HabitCheckbox from '$lib/components/ui/habit-checkbox.svelte';
	import { habitIcon } from '$lib/icons/habit-icons';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';

	const habits = $derived(plannerStore.todayHabits);
	const done = $derived(plannerStore.completedHabits.length);

	/** На дашборде показываем первые три — остальные живут на своём экране. */
	const featured = $derived(habits.slice(0, 3));
</script>

<GlassCard>
	<div class="mb-3 flex items-center gap-2">
		<CheckCircle size={16} weight="light" class="text-lavender" />
		<h2 class="flex-1 text-sm font-medium">Привычки</h2>
		<span class="tabular text-sm font-semibold">
			<!-- Неразрывный пробел: обычный схлопывается на границе тега, и счётчик слипается в «4из 6». -->
			{done}<span class="font-normal text-muted-foreground">&nbsp;из {habits.length}</span>
		</span>
	</div>

	{#if habits.length === 0}
		<p class="py-2 text-sm leading-relaxed text-muted-foreground">
			На сегодня привычек нет. Добавьте первую — она появится здесь.
		</p>
		<button
			type="button"
			onclick={() => ui.openHabitSheet()}
			class="mt-2 w-full rounded-full border border-line-strong py-2.5 text-xs font-medium
			       transition-[transform,border-color] duration-500 ease-flux
			       hover:border-lavender/60 active:scale-[0.98]"
		>
			Новая привычка
		</button>
	{:else}
		<!--
			Сегменты по числу привычек, а не сплошная полоса: «4 из 6» должно
			читаться с экрана без пересчёта в проценты.
		-->
		<div class="mb-4 flex gap-1.5" aria-hidden="true">
			{#each habits as habit (habit.id)}
				<span
					class="h-1 flex-1 rounded-full transition-colors duration-500 ease-flux
					       {plannerStore.isHabitCompleted(habit.id) ? 'bg-lavender' : 'bg-line'}"
				></span>
			{/each}
		</div>

		<div class="flex flex-col gap-0.5">
			{#each featured as habit (habit.id)}
				<HabitCheckbox
					label={habit.name}
					checked={plannerStore.isHabitCompleted(habit.id)}
					icon={habitIcon(habit.icon)}
					onchange={() => plannerStore.toggleHabit(habit.id)}
				/>
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
			<CaretRight size={12} weight="light" />
		</a>

		{#if plannerStore.longestStreak > 0}
			<span class="tabular shrink-0 text-xs text-muted-foreground">
				Лучшая серия: <span class="text-foreground">{plannerStore.longestStreak}</span>
			</span>
		{/if}
	</div>
</GlassCard>
