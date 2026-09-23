<script lang="ts">
	import { CaretRight, CheckCircle } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { habitIcon } from '$lib/icons/habit-icons';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';

	const habits = $derived(plannerStore.todayHabits);
	const done = $derived(plannerStore.completedHabits.length);

	/** На дашборде показываем первые четыре — ровно сетка 2×2, остальные на своём экране. */
	const featured = $derived(habits.slice(0, 4));

	function toggle(id: string) {
		const next = plannerStore.toggleHabit(id);
		if (next) telegram.haptic.notification('success');
		else telegram.haptic.impact('light');
	}
</script>

<GlassCard tone="mint" id="habits-card">
	<div class="mb-3 flex items-center gap-2">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<CheckCircle size={15} weight="regular" class="text-tone" />
		</span>
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
			       hover:border-tone/60 active:scale-[0.98]"
		>
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
					role="checkbox"
					aria-checked={checked}
					aria-label={habit.name}
					class="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left
					       transition-[background-color,border-color] duration-400 ease-flux active:scale-[0.97]
					       {checked ? 'border-tone/50 bg-tone/15' : 'border-line/70 bg-white/[0.02]'}"
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
			<CaretRight size={12} weight="light" />
		</a>

		{#if plannerStore.longestStreak > 0}
			<span class="tabular shrink-0 text-xs text-muted-foreground">
				Лучшая серия: <span class="text-foreground">{plannerStore.longestStreak}</span>
			</span>
		{/if}
	</div>
</GlassCard>
