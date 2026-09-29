<script lang="ts">
	import { untrack } from 'svelte';
	import { Minus, Plus } from 'phosphor-svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import {
		goalsOutOfDate,
		recordWeight,
		refreshGoalsFromWeight,
		validateWeight
	} from '$lib/services/weightService';
	import { formatWeight } from '$lib/utils/format';

	/**
	 * Взвешивание за день.
	 *
	 * Одно поле и шаги по сто граммов: вес вводят стоя у весов, часто одной
	 * рукой, и набирать «78,4» на цифровой клавиатуре в этот момент неудобно.
	 * Шаг отсчитывается от прошлого значения, поэтому обычное утро — это
	 * пара нажатий без клавиатуры вовсе.
	 */

	type Props = {
		onsaved: () => void;
		oncancel?: () => void;
	};

	let { onsaved, oncancel }: Props = $props();

	const uid = $props.id();

	const today = untrack(() => plannerStore.currentDate);
	const existing = untrack(() => plannerStore.getWeight(today));
	const previous = untrack(() => plannerStore.latestWeight);

	/**
	 * Строка, а не число: у input type="number" нельзя нормально очистить поле,
	 * а на телефоне дробная часть отделяется запятой, которую Number() не берёт.
	 */
	let value = $state(
		existing ? String(existing.weightKg) : previous ? String(previous.weightKg) : ''
	);
	let error = $state<string | null>(null);

	const parsed = $derived(Number(value.trim().replace(',', '.')));

	/** Разница с прошлым взвешиванием — то, ради чего на весы и встают. */
	const delta = $derived(
		previous && Number.isFinite(parsed) && parsed > 0 && previous.date !== today
			? Math.round((parsed - previous.weightKg) * 10) / 10
			: null
	);

	function step(amount: number) {
		const base = Number.isFinite(parsed) && parsed > 0 ? parsed : (previous?.weightKg ?? 70);
		telegram.haptic.selection();
		value = String(Math.round((base + amount) * 10) / 10);
		error = null;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();

		const errors = validateWeight(parsed);
		if (Object.keys(errors).length > 0) {
			error = errors.weightKg;
			telegram.haptic.notification('error');
			return;
		}

		const result = recordWeight(parsed, today);
		if (!result.ok) {
			error = Object.values(result.errors)[0] ?? 'Не удалось записать';
			telegram.haptic.notification('error');
			return;
		}

		telegram.haptic.notification('success');
		onsaved();
	}

	function refreshGoals() {
		const result = refreshGoalsFromWeight();
		telegram.haptic.notification(result.ok ? 'success' : 'error');
		if (result.ok) onsaved();
	}
</script>

<form onsubmit={submit} class="py-1">
	<label for="{uid}-weight" class="block text-center text-xs text-muted-foreground">Вес, кг</label>

	<div class="mt-3 flex items-center gap-3">
		<button
			type="button"
			onclick={() => step(-0.1)}
			aria-label="Меньше на сто граммов"
			class="grid size-12 shrink-0 place-items-center rounded-full border border-line-strong
			       transition-transform duration-500 ease-flux active:scale-90"
		>
			<Minus size={16} weight="light" />
		</button>

		<!--
			Цифра — герой экрана: на весы встают ради одного числа.
			Ширина поля — по числу знаков (моноширинное начертание, ch
			точен), чтобы «кг» стояло вплотную к цифрам, а не у края рамки.
		-->
		<div
			class="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 rounded-card border
			       bg-ink/[0.03] px-3 py-4 transition-colors duration-300 ease-flux
			       focus-within:border-lavender
			       {error ? 'border-destructive' : 'border-line-strong'}"
		>
			<input
				id="{uid}-weight"
				bind:value
				oninput={() => (error = null)}
				type="text"
				inputmode="decimal"
				autocomplete="off"
				placeholder="78,4"
				aria-invalid={Boolean(error)}
				class="fx-num min-w-0 bg-transparent text-center text-6xl leading-none outline-none
				       placeholder:text-muted-foreground/30"
				style:width="{Math.max(3, (value || '78,4').length) + 0.5}ch"
			/>
			<span aria-hidden="true" class="shrink-0 text-sm text-muted-foreground">кг</span>
		</div>

		<button
			type="button"
			onclick={() => step(0.1)}
			aria-label="Больше на сто граммов"
			class="grid size-12 shrink-0 place-items-center rounded-full border border-line-strong
			       transition-transform duration-500 ease-flux active:scale-90"
		>
			<Plus size={16} weight="light" />
		</button>
	</div>

	{#if error}
		<p class="mt-2.5 text-center text-xs text-destructive">{error}</p>
	{:else if delta !== null && delta !== 0}
		<p class="mt-2.5 text-center text-xs text-muted-foreground">
			<span class="tabular font-medium text-lavender"
				>{delta > 0 ? '+' : '−'}{formatWeight(Math.abs(delta))} кг</span
			>
			к прошлому взвешиванию
		</p>
	{:else if existing}
		<p class="mt-2.5 text-center text-xs text-muted-foreground">
			Сегодня уже записано — новое значение заменит прежнее.
		</p>
	{:else}
		<p class="mt-2.5 text-center text-xs text-muted-foreground">Кнопки меняют вес на сто граммов</p>
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
			class="flex-[1.4] rounded-full bg-lavender py-3 text-sm font-medium text-on-accent
			       shadow-accent transition-transform duration-500 ease-flux
			       hover:bg-lavender-hi active:scale-[0.98]"
		>
			Записать
		</button>
	</div>

	{#if goalsOutOfDate()}
		<!--
			Цели считаются от веса, и анкета с прошлогодним весом тихо выдаёт
			цифры, к которым нет доверия. Предложение появляется только когда
			разница заметна, и пересчёт идёт по кнопке, а не молча.
		-->
		<div class="mt-4 rounded-xl border border-line/70 bg-ink/[0.02] p-3">
			<p class="text-xs leading-relaxed text-muted-foreground">
				В анкете {formatWeight(plannerStore.doc.settings.profile?.weightKg ?? 0)} кг, на весах
				{formatWeight(plannerStore.latestWeight?.weightKg ?? 0)} кг. Цели считаются от веса — пересчитать?
			</p>
			<button
				type="button"
				onclick={refreshGoals}
				class="mt-2.5 w-full rounded-full border border-line-strong py-2.5 text-xs font-medium
				       transition-[transform,border-color] duration-500 ease-flux
				       hover:border-lavender/60 active:scale-[0.98]"
			>
				Пересчитать цели
			</button>
		</div>
	{/if}
</form>
