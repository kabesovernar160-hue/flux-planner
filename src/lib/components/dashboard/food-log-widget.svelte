<script lang="ts">
	import { Plus } from 'phosphor-svelte';
	import FoodList from '$lib/components/nutrition/food-list.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';

	// Раньше это была отдельная карточка. Теперь список вложен в карточку
	// питания: своей рамки и заголовка здесь больше нет, их рисует родитель.
	const entries = $derived(plannerStore.todayFoods);
</script>

<FoodList {entries} />

<button
	type="button"
	onclick={() => ui.openFoodSheet()}
	class="mt-3 flex w-full items-center justify-center gap-2 rounded-full border
	       border-line-strong py-2.5 text-xs font-medium transition-[transform,border-color]
	       duration-500 ease-flux hover:border-tone/60 active:scale-[0.98]"
>
	<Plus size={13} weight="bold" class="text-tone" />
	Добавить еду
</button>
