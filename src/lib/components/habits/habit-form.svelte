<script lang="ts">
	import { untrack } from 'svelte';
	import { habitIcon, HABIT_ICON_KEYS } from '$lib/icons/habit-icons';
	import {
		createHabit,
		updateHabit,
		validateHabitDraft,
		type HabitDraft
	} from '$lib/services/habitService';
	import type { Habit, HabitFrequency } from '$lib/types/habit';
	import { telegram } from '$lib/telegram';

	type Props = {
		/** Привычка для правки. Без неё форма создаёт новую. */
		habit?: Habit | null;
		onsaved: () => void;
		oncancel?: () => void;
	};

	let { habit = null, onsaved, oncancel }: Props = $props();

	const uid = $props.id();

	// Начальные значения снимаются один раз: форма правит копию, иначе
	// приходящие снаружи данные затирали бы ввод прямо во время набора.
	const initial = untrack(() => habit);

	let name = $state(initial?.name ?? '');
	let icon = $state(initial?.icon ?? 'check');
	let frequency = $state<HabitFrequency>(initial?.frequency ?? 'daily');
	let targetDays = $state<number[]>(initial?.targetDays ? [...initial.targetDays] : [1, 3, 5]);

	let errors = $state<Record<string, string>>({});
	let submitted = $state(false);

	/** 0 — воскресенье, как в Date.getDay(). Порядок показа — с понедельника. */
	const WEEK = [
		{ day: 1, label: 'Пн' },
		{ day: 2, label: 'Вт' },
		{ day: 3, label: 'Ср' },
		{ day: 4, label: 'Чт' },
		{ day: 5, label: 'Пт' },
		{ day: 6, label: 'Сб' },
		{ day: 0, label: 'Вс' }
	];

	const FREQUENCIES: { id: HabitFrequency; label: string; hint: string }[] = [
		{ id: 'daily', label: 'Каждый день', hint: 'без выходных' },
		{ id: 'weekdays', label: 'По будням', hint: 'пн–пт' },
		{ id: 'custom', label: 'Свои дни', hint: 'выбрать вручную' }
	];

	function buildDraft(): HabitDraft {
		return {
			name,
			icon,
			frequency,
			targetDays: frequency === 'custom' ? targetDays : undefined
		};
	}

	// До первой отправки ошибки не показываются: ругаться на человека за то,
	// что он ещё не начал заполнять, незачем.
	$effect(() => {
		if (submitted) errors = validateHabitDraft(buildDraft());
	});

	function toggleDay(day: number) {
		telegram.haptic.selection();
		targetDays = targetDays.includes(day)
			? targetDays.filter((value) => value !== day)
			: [...targetDays, day].sort();
	}

	function pickIcon(key: string) {
		telegram.haptic.selection();
		icon = key;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		submitted = true;

		const draft = buildDraft();
		const found = validateHabitDraft(draft);
		errors = found;

		if (Object.keys(found).length > 0) {
			telegram.haptic.notification('error');
			return;
		}

		const result = habit ? updateHabit(habit.id, draft) : createHabit(draft);

		if (!result.ok) {
			errors = result.errors;
			telegram.haptic.notification('error');
			return;
		}

		telegram.haptic.notification('success');
		onsaved();
	}
</script>

<form onsubmit={submit} class="py-1">
	<label for="{uid}-name" class="text-xs text-muted-foreground">Название</label>
	<input
		id="{uid}-name"
		bind:value={name}
		type="text"
		autocomplete="off"
		placeholder="Зарядка"
		aria-invalid={Boolean(errors.name)}
		class="mt-1.5 w-full rounded-xl border bg-white/[0.03] px-3 py-2.5 text-sm transition-colors
		       duration-300 ease-flux outline-none placeholder:text-muted-foreground/50
		       focus:border-lavender {errors.name ? 'border-destructive' : 'border-line-strong'}"
	/>
	{#if errors.name}
		<p class="mt-1 text-xs text-destructive">{errors.name}</p>
	{/if}

	<p class="mt-4 text-xs text-muted-foreground">Иконка</p>
	<!--
		Иконка помогает опознать привычку в списке до чтения подписи,
		поэтому выбор отдельный, а не «первая буква названия».
	-->
	<div class="mt-2 grid grid-cols-5 gap-2">
		{#each HABIT_ICON_KEYS as key (key)}
			{@const Icon = habitIcon(key)}
			<button
				type="button"
				onclick={() => pickIcon(key)}
				aria-label="Иконка {key}"
				aria-pressed={icon === key}
				class="grid aspect-square place-items-center rounded-xl border transition-[transform,border-color,background-color]
				       duration-500 ease-flux active:scale-90
				       {icon === key
					? 'border-lavender bg-lavender/12 text-lavender'
					: 'border-line/70 bg-white/[0.02] text-muted-foreground'}"
			>
				<Icon size={18} weight="light" />
			</button>
		{/each}
	</div>

	<p class="mt-4 text-xs text-muted-foreground">Когда повторять</p>
	<div class="mt-2 flex flex-col gap-2">
		{#each FREQUENCIES as option (option.id)}
			<button
				type="button"
				onclick={() => {
					telegram.haptic.selection();
					frequency = option.id;
				}}
				aria-pressed={frequency === option.id}
				class="flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left
				       transition-[transform,border-color] duration-500 ease-flux active:scale-[0.98]
				       {frequency === option.id
					? 'border-lavender bg-lavender/[0.08]'
					: 'border-line/70 bg-white/[0.02]'}"
			>
				<span
					class="grid size-4 shrink-0 place-items-center rounded-full border
					       {frequency === option.id ? 'border-lavender' : 'border-line-strong'}"
				>
					{#if frequency === option.id}
						<span class="size-2 rounded-full bg-lavender"></span>
					{/if}
				</span>
				<span class="min-w-0 flex-1">
					<span class="block text-sm">{option.label}</span>
					<span class="block text-xs text-muted-foreground">{option.hint}</span>
				</span>
			</button>
		{/each}
	</div>

	{#if frequency === 'custom'}
		<div class="mt-3 flex gap-1.5">
			{#each WEEK as { day, label } (day)}
				<button
					type="button"
					onclick={() => toggleDay(day)}
					aria-pressed={targetDays.includes(day)}
					class="flex-1 rounded-lg border py-2 text-xs transition-[transform,border-color,background-color]
					       duration-500 ease-flux active:scale-90
					       {targetDays.includes(day)
						? 'border-lavender bg-lavender/12 text-lavender'
						: 'border-line/70 bg-white/[0.02] text-muted-foreground'}"
				>
					{label}
				</button>
			{/each}
		</div>
		{#if errors.targetDays}
			<p class="mt-1.5 text-xs text-destructive">{errors.targetDays}</p>
		{/if}
	{/if}

	<div class="mt-5 flex gap-2">
		{#if oncancel}
			<button
				type="button"
				onclick={oncancel}
				class="flex-1 rounded-full border border-line-strong py-3 text-sm font-medium
				       transition-transform duration-500 ease-flux active:scale-[0.98]"
			>
				Отмена
			</button>
		{/if}
		<button
			type="submit"
			class="flex-[1.4] rounded-full bg-lavender py-3 text-sm font-medium text-void
			       shadow-accent transition-transform duration-500 ease-flux
			       hover:bg-lavender-hi active:scale-[0.98]"
		>
			{habit ? 'Сохранить' : 'Добавить'}
		</button>
	</div>
</form>
