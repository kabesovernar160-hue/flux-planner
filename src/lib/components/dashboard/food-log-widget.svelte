<script lang="ts">
	import { ForkKnife, Plus } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import FoodList from '$lib/components/nutrition/food-list.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { formatNumber } from '$lib/utils/format';

	const entries = $derived(plannerStore.todayFoods);
</script>

<GlassCard>
	<div class="mb-3 flex items-center gap-2">
		<ForkKnife size={16} weight="light" class="text-lavender" />
		<h2 class="flex-1 text-sm font-medium">Что съедено</h2>
		{#if entries.length > 0}
			<span class="tabular text-xs text-muted-foreground">
				{entries.length} · {formatNumber(plannerStore.caloriesConsumed)} ккал
			</span>
		{/if}
	</div>

	<FoodList {entries} />

	<button
		type="button"
		onclick={() => ui.openFoodSheet()}
		class="mt-3 flex w-full items-center justify-center gap-2 rounded-full border
		       border-line-strong py-2.5 text-xs font-medium transition-[transform,border-color]
		       duration-500 ease-flux hover:border-lavender/60 active:scale-[0.98]"
	>
		<Plus size={13} weight="bold" class="text-lavender" />
		Добавить еду
	</button>
</GlassCard>
