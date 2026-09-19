<script lang="ts">
	import { Archive, ArrowCounterClockwise, Plus, Trash } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import HabitCheckbox from '$lib/components/ui/habit-checkbox.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { habitIcon } from '$lib/icons/habit-icons';
	import {
		archiveHabit,
		deleteHabit,
		getHabitStreak,
		restoreHabit
	} from '$lib/services/habitService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import type { Habit } from '$lib/types/habit';
	import { isScheduledOn } from '$lib/utils/habitFrequency';

	const active = $derived(plannerStore.habits.filter((habit) => !habit.archived));
	const archived = $derived(plannerStore.habits.filter((habit) => habit.archived));

	const FREQUENCY_LABEL: Record<Habit['frequency'], string> = {
		daily: 'Каждый день',
		weekdays: 'По будням',
		custom: 'Свои дни'
	};

	const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

	function scheduleText(habit: Habit): string {
		if (habit.frequency !== 'custom') return FREQUENCY_LABEL[habit.frequency];
		const days = (habit.targetDays ?? []).map((day) => DAY_LABELS[day]).join(', ');
		return days || 'Дни не выбраны';
	}

	/**
	 * Удаление подтверждается вторым нажатием, а не диалогом.
	 *
	 * Системный confirm() в WebView Telegram выглядит чужеродно и на части
	 * клиентов блокирует поток, а полноценный диалог ради одной кнопки —
	 * лишний слой. Кнопка сама превращается в «Точно удалить?» на несколько
	 * секунд и возвращается обратно.
	 */
	let pendingDelete = $state<string | null>(null);
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;

	function askDelete(id: string) {
		telegram.haptic.impact('medium');

		if (pendingDelete === id) {
			deleteHabit(id);
			pendingDelete = null;
			telegram.haptic.notification('success');
			return;
		}

		pendingDelete = id;
		if (pendingTimer) clearTimeout(pendingTimer);
		pendingTimer = setTimeout(() => (pendingDelete = null), 4000);
	}

	$effect(() => () => {
		if (pendingTimer) clearTimeout(pendingTimer);
	});
</script>

<PageHeader title="Привычки" subtitle="{active.length} активных" back="/">
	{#snippet action()}
		<button
			type="button"
			onclick={() => ui.openHabitSheet()}
			aria-label="Новая привычка"
			class="grid size-9 shrink-0 place-items-center rounded-full bg-lavender text-void
			       shadow-accent transition-transform duration-500 ease-flux active:scale-90"
		>
			<Plus size={16} weight="bold" />
		</button>
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-4">
	<GlassCard>
		{#if active.length === 0}
			<p class="py-2 text-sm leading-relaxed text-muted-foreground">
				Привычек пока нет. Добавьте первую — она появится на главной в те дни, когда запланирована.
			</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each active as habit (habit.id)}
					{@const streak = getHabitStreak(habit.id)}
					{@const scheduled = isScheduledOn(habit, plannerStore.currentDate)}
					<li class="rounded-card border border-line/70 bg-white/[0.02] p-3">
						{#if scheduled}
							<HabitCheckbox
								label={habit.name}
								checked={plannerStore.isHabitCompleted(habit.id)}
								icon={habitIcon(habit.icon)}
								onchange={() => plannerStore.toggleHabit(habit.id)}
							/>
						{:else}
							<!-- Сегодня привычка не запланирована: отмечать нечего, но видеть её нужно. -->
							{@const Icon = habitIcon(habit.icon)}
							<div class="flex items-center gap-3 px-1 py-2 opacity-60">
								<Icon size={18} weight="light" class="shrink-0 text-muted-foreground" />
								<span class="min-w-0 flex-1 truncate text-sm">{habit.name}</span>
								<span class="shrink-0 text-[11px] text-muted-foreground">не сегодня</span>
							</div>
						{/if}

						<div class="mt-2 flex items-center gap-2 border-t border-line/70 pt-2.5">
							<span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
								{scheduleText(habit)}
								{#if streak && streak.current > 0}
									· серия {streak.current}
								{/if}
							</span>

							<button
								type="button"
								onclick={() => ui.openHabitSheet(habit.id)}
								class="shrink-0 rounded-full border border-line-strong px-3 py-1 text-[11px]
								       transition-transform duration-500 ease-flux active:scale-95"
							>
								Изменить
							</button>

							<button
								type="button"
								onclick={() => {
									telegram.haptic.impact('light');
									archiveHabit(habit.id);
								}}
								aria-label="В архив"
								class="grid size-7 shrink-0 place-items-center rounded-full border
								       border-line-strong text-muted-foreground transition-transform
								       duration-500 ease-flux active:scale-90"
							>
								<Archive size={12} weight="light" />
							</button>

							<button
								type="button"
								onclick={() => askDelete(habit.id)}
								aria-label="Удалить {habit.name}"
								class="shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition-[transform,color,border-color]
								       duration-500 ease-flux active:scale-95
								       {pendingDelete === habit.id
									? 'border-destructive text-destructive'
									: 'border-line-strong text-muted-foreground'}"
							>
								{#if pendingDelete === habit.id}
									Точно?
								{:else}
									<Trash size={12} weight="light" />
								{/if}
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</GlassCard>

	{#if archived.length > 0}
		<GlassCard>
			<h2 class="mb-3 flex items-center gap-2 text-sm font-medium">
				<Archive size={15} weight="light" class="text-muted-foreground" />
				Архив
			</h2>

			<!--
				Архив — это состояние, а не удаление: привычка не мешает на главной,
				но её история и серии остаются.
			-->
			<ul class="flex flex-col gap-1.5">
				{#each archived as habit (habit.id)}
					<li class="flex items-center gap-3 rounded-xl border border-line/70 px-3 py-2.5">
						<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{habit.name}</span>
						<button
							type="button"
							onclick={() => {
								telegram.haptic.impact('light');
								restoreHabit(habit.id);
							}}
							class="flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong
							       px-3 py-1 text-[11px] transition-transform duration-500 ease-flux active:scale-95"
						>
							<ArrowCounterClockwise size={11} weight="light" />
							Вернуть
						</button>
					</li>
				{/each}
			</ul>
		</GlassCard>
	{/if}
</div>
