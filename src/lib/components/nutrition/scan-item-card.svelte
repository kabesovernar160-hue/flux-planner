<script lang="ts">
	import { Minus, PencilSimple, Plus, Trash } from 'phosphor-svelte';
	import type { FoodScanItem } from '$lib/types/nutrition';
	import { telegram } from '$lib/telegram';
	import { confidenceLevel, rescaleItem } from '$lib/utils/foodScan';
	import { formatMacro, formatNumber } from '$lib/utils/format';

	type Props = {
		item: FoodScanItem;
		onchange: (next: FoodScanItem) => void;
		onremove: () => void;
	};

	let { item, onchange, onremove }: Props = $props();

	const uid = $props.id();

	let editing = $state(false);

	/**
	 * Вес в поле хранится строкой.
	 *
	 * У input type="number" нельзя нормально стереть содержимое, чтобы вписать
	 * своё значение: bind отдаёт то число, то undefined. Строка снимает этот
	 * вопрос и заодно позволяет ввести «250» без борьбы с ведущим нулём.
	 */
	let gramsText = $state('');

	/** Порог для подписи «по фото трудно определить» у отдельного компонента. */
	const level = $derived(confidenceLevel(item.confidence));

	const DOT_CLASS: Record<string, string> = {
		high: 'bg-success',
		medium: 'bg-lavender',
		low: 'bg-muted-foreground'
	};

	function startEditing() {
		telegram.haptic.impact('light');
		gramsText = String(Math.round(item.estimatedGrams));
		editing = true;
	}

	function applyGrams(grams: number) {
		// Ноль граммов — это не порция, а удалённый компонент: для удаления
		// есть отдельная кнопка, и превращать в него опечатку не нужно.
		const safe = Math.min(20_000, Math.max(1, Math.round(grams)));
		gramsText = String(safe);
		onchange(rescaleItem(item, safe));
	}

	function step(delta: number) {
		telegram.haptic.selection();
		applyGrams((Number(gramsText) || item.estimatedGrams) + delta);
	}

	function onGramsInput(value: string) {
		gramsText = value;
		const parsed = Number(value.replace(',', '.'));
		// Пока в поле мусор, пересчёт не трогаем: пользователь ещё печатает.
		if (Number.isFinite(parsed) && parsed > 0) onchange(rescaleItem(item, Math.round(parsed)));
	}

	function onNameInput(value: string) {
		onchange({ ...item, name: value });
	}

	function remove() {
		telegram.haptic.impact('medium');
		onremove();
	}
</script>

<div class="rounded-card border border-line/70 bg-white/[0.02] p-3.5">
	<div class="flex items-start gap-3">
		<span aria-hidden="true" class="mt-1.5 size-2 shrink-0 rounded-full {DOT_CLASS[level]}"></span>

		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-medium">{item.name}</p>
			<p class="tabular mt-0.5 text-xs text-muted-foreground">
				{formatNumber(Math.round(item.estimatedGrams))} г · {formatNumber(item.calories)} ккал
				{#if item.nutritionSource === 'estimate'}
					<span class="text-muted-foreground/70">· оценка</span>
				{/if}
			</p>
			{#if item.notes}
				<p class="mt-0.5 truncate text-xs text-muted-foreground/70">{item.notes}</p>
			{/if}
		</div>

		{#if !editing}
			<button
				type="button"
				onclick={startEditing}
				class="flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-3
				       py-1.5 text-xs transition-transform duration-500 ease-flux active:scale-95"
			>
				<PencilSimple size={12} weight="light" />
				Изменить
			</button>
		{/if}
	</div>

	{#if editing}
		<div class="mt-3.5 border-t border-line/70 pt-3.5">
			<label for="{uid}-name" class="text-xs text-muted-foreground">Название</label>
			<input
				id="{uid}-name"
				value={item.name}
				oninput={(event) => onNameInput(event.currentTarget.value)}
				type="text"
				autocomplete="off"
				class="mt-1.5 w-full rounded-xl border border-line-strong bg-white/[0.03] px-3 py-2.5
				       text-sm transition-colors duration-300 ease-flux outline-none focus:border-lavender"
			/>

			<label for="{uid}-grams" class="mt-3 block text-xs text-muted-foreground">Порция, г</label>
			<div class="mt-1.5 flex items-center gap-2">
				<button
					type="button"
					onclick={() => step(-10)}
					aria-label="Уменьшить порцию на 10 граммов"
					class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
					       transition-transform duration-500 ease-flux active:scale-90"
				>
					<Minus size={14} weight="light" />
				</button>

				<input
					id="{uid}-grams"
					value={gramsText}
					oninput={(event) => onGramsInput(event.currentTarget.value)}
					onblur={() => applyGrams(Number(gramsText.replace(',', '.')) || item.estimatedGrams)}
					type="text"
					inputmode="numeric"
					autocomplete="off"
					class="tabular min-w-0 flex-1 rounded-xl border border-line-strong bg-white/[0.03]
					       px-3 py-2.5 text-center text-sm transition-colors duration-300 ease-flux
					       outline-none focus:border-lavender"
				/>

				<button
					type="button"
					onclick={() => step(10)}
					aria-label="Увеличить порцию на 10 граммов"
					class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
					       transition-transform duration-500 ease-flux active:scale-90"
				>
					<Plus size={14} weight="light" />
				</button>
			</div>

			<!-- Пересчёт мгновенный: пользователь видит цену своей правки сразу. -->
			<div class="tabular mt-3 grid grid-cols-4 gap-1.5 text-center text-[11px]">
				{#each [['Ккал', formatNumber(item.calories)], ['Б', formatMacro(item.protein)], ['Ж', formatMacro(item.fat)], ['У', formatMacro(item.carbs)]] as [label, value] (label)}
					<div class="rounded-lg bg-white/[0.03] px-1 py-1.5">
						<p class="text-muted-foreground">{label}</p>
						<p class="mt-0.5 font-medium">{value}</p>
					</div>
				{/each}
			</div>

			<div class="mt-3 flex gap-2">
				<button
					type="button"
					onclick={remove}
					class="flex items-center gap-1.5 rounded-full border border-line-strong px-3.5 py-2
					       text-xs text-muted-foreground transition-transform duration-500 ease-flux
					       active:scale-95"
				>
					<Trash size={13} weight="light" />
					Убрать
				</button>
				<button
					type="button"
					onclick={() => (editing = false)}
					class="flex-1 rounded-full border border-line-strong py-2 text-xs font-medium
					       transition-transform duration-500 ease-flux active:scale-[0.98]"
				>
					Готово
				</button>
			</div>
		</div>
	{/if}
</div>
