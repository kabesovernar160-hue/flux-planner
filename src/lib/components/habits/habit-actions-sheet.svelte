<script lang="ts">
	import { Archive, PencilSimple, Trash } from 'phosphor-svelte';
	import Sheet from '$lib/components/ui/sheet.svelte';
	import { archiveHabit, deleteHabit, getHabitStreak } from '$lib/services/habitService';
	import { ui } from '$lib/state/ui.svelte';
	import { telegram } from '$lib/telegram';
	import type { Habit } from '$lib/types/habit';

	type Props = {
		/** Привычка, для которой открыто меню. null — шторка закрыта. */
		habit: Habit | null;
		onclose: () => void;
	};

	let { habit, onclose }: Props = $props();

	const streak = $derived(habit ? getHabitStreak(habit.id) : null);

	/**
	 * Удаление подтверждается вторым нажатием, а не диалогом.
	 *
	 * Системный confirm() в WebView Telegram выглядит чужеродно и на части
	 * клиентов блокирует поток, а диалог поверх шторки — лишний слой.
	 * Кнопка сама превращается в «Точно удалить?» на несколько секунд.
	 */
	let confirming = $state(false);
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;

	function resetConfirm() {
		confirming = false;
		if (confirmTimer) clearTimeout(confirmTimer);
		confirmTimer = null;
	}

	// Новая привычка в меню — новое подтверждение: «Точно?» от предыдущей
	// не должно достаться следующей.
	$effect(() => {
		void habit?.id;
		resetConfirm();
	});

	$effect(() => () => resetConfirm());

	function edit() {
		if (!habit) return;
		const id = habit.id;
		onclose();
		ui.openHabitSheet(id);
	}

	function archive() {
		if (!habit) return;
		telegram.haptic.impact('light');
		archiveHabit(habit.id);
		onclose();
	}

	function remove() {
		if (!habit) return;
		telegram.haptic.impact('medium');

		if (confirming) {
			deleteHabit(habit.id);
			resetConfirm();
			telegram.haptic.notification('success');
			onclose();
			return;
		}

		confirming = true;
		confirmTimer = setTimeout(() => (confirming = false), 4000);
	}

	const stats = $derived(
		streak
			? [
					{ label: 'Серия', value: streak.current },
					{ label: 'Рекорд', value: streak.longest },
					{ label: 'Всего', value: streak.totalCompleted }
				]
			: []
	);
</script>

<Sheet open={habit !== null} title={habit?.name ?? ''} {onclose}>
	<div class="tone-mint pb-1">
		{#if stats.length > 0}
			<!-- Цифры привычки: меню открывают и затем, чтобы посмотреть, как она держится. -->
			<dl class="mb-4 grid grid-cols-3 gap-2">
				{#each stats as stat (stat.label)}
					<div class="rounded-xl border border-tone/15 bg-tone/[0.06] px-3 py-2.5">
						<dt class="text-[11px] text-muted-foreground">{stat.label}</dt>
						<dd class="fx-num mt-1.5 text-3xl leading-none text-tone">{stat.value}</dd>
					</div>
				{/each}
			</dl>
		{/if}

		<ul class="flex flex-col gap-1.5">
			<li>
				<button
					type="button"
					onclick={edit}
					class="flex w-full items-center gap-3 rounded-xl border border-line/70 bg-ink/[0.02] px-4 py-3.5
					       text-left text-sm transition-transform duration-500 ease-flux active:scale-[0.98]"
				>
					<PencilSimple size={18} weight="light" class="shrink-0 text-muted-foreground" />
					Изменить
				</button>
			</li>
			<li>
				<button
					type="button"
					onclick={archive}
					class="flex w-full items-center gap-3 rounded-xl border border-line/70 bg-ink/[0.02] px-4 py-3.5
					       text-left text-sm transition-transform duration-500 ease-flux active:scale-[0.98]"
				>
					<Archive size={18} weight="light" class="shrink-0 text-muted-foreground" />
					<span class="flex-1">В архив</span>
					<span class="text-xs text-muted-foreground">история сохранится</span>
				</button>
			</li>
			<li>
				<button
					type="button"
					onclick={remove}
					aria-live="polite"
					class="flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm
					       transition-[transform,border-color,background-color,color] duration-500 ease-flux active:scale-[0.98]
					       {confirming
						? 'border-destructive/60 bg-destructive/10 text-destructive'
						: 'border-line/70 bg-ink/[0.02] text-destructive'}"
				>
					<Trash size={18} weight={confirming ? 'fill' : 'light'} class="shrink-0" />
					<span class="flex-1">{confirming ? 'Точно удалить?' : 'Удалить'}</span>
					{#if confirming}
						<span class="text-xs text-destructive/80">нажмите ещё раз</span>
					{/if}
				</button>
			</li>
		</ul>
	</div>
</Sheet>
