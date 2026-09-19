<script lang="ts">
	import { telegram } from '$lib/telegram';
	import { MEAL_LABELS, MEALS, type MealType } from '$lib/utils/meals';

	/**
	 * Выбор приёма пищи.
	 *
	 * Четыре кнопки, а не выпадающий список: вариантов всего четыре, и открывать
	 * ради них список — лишний тап на экране, где всё остальное вводится сразу.
	 */

	type Props = {
		value: MealType;
		onpick: (meal: MealType) => void;
		label?: string;
	};

	let { value, onpick, label = 'Приём пищи' }: Props = $props();

	function pick(meal: MealType) {
		if (meal === value) return;
		telegram.haptic.selection();
		onpick(meal);
	}
</script>

<div>
	<p class="text-xs text-muted-foreground">{label}</p>
	<div class="mt-1.5 flex gap-1.5" role="radiogroup" aria-label={label}>
		{#each MEALS as meal (meal)}
			<button
				type="button"
				role="radio"
				aria-checked={value === meal}
				onclick={() => pick(meal)}
				class="flex-1 rounded-full border py-2 text-[11px] font-medium
				       transition-[transform,border-color,background-color] duration-400 ease-flux
				       active:scale-[0.97]
				       {value === meal
					? 'border-lavender bg-lavender/15 text-foreground'
					: 'border-line-strong text-muted-foreground'}"
			>
				{MEAL_LABELS[meal]}
			</button>
		{/each}
	</div>
</div>
