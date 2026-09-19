<script lang="ts">
	import { MagnifyingGlass } from 'phosphor-svelte';
	import type { FoodReference } from '$lib/types/nutrition';
	import { telegram } from '$lib/telegram';
	import { nutritionForGrams } from '$lib/utils/foodScan';
	import { suggestFoods } from '$lib/utils/foodSearch';
	import { formatNumber } from '$lib/utils/format';

	type Props = {
		/** Выбран продукт: название и значения на 100 г уходят в форму. */
		onpick: (food: FoodReference) => void;
	};

	let { onpick }: Props = $props();

	const uid = $props.id();

	let query = $state('');

	/**
	 * Поиск идёт по локальной таблице, без сети.
	 *
	 * Для ручного ввода это принципиально: его главный сценарий — «записать
	 * быстро», в том числе в метро без связи. Сетевой запрос на каждую букву
	 * сделал бы поле неотзывчивым ровно там, где нужна скорость.
	 */
	const matches = $derived(suggestFoods(query));

	function pick(food: FoodReference) {
		telegram.haptic.selection();
		onpick(food);
		query = '';
	}
</script>

<div>
	<label for="{uid}-search" class="text-xs text-muted-foreground">Найти продукт</label>
	<div class="relative mt-1.5">
		<MagnifyingGlass
			size={15}
			weight="light"
			class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
		/>
		<input
			id="{uid}-search"
			bind:value={query}
			type="text"
			autocomplete="off"
			placeholder="Овсянка, курица, банан…"
			class="w-full rounded-xl border border-line-strong bg-white/[0.03] py-2.5 pr-3 pl-9
			       text-sm transition-colors duration-300 ease-flux outline-none
			       placeholder:text-muted-foreground/50 focus:border-lavender"
		/>
	</div>

	{#if query.trim().length > 0}
		{#if matches.length === 0}
			<p class="mt-2 text-xs text-muted-foreground">
				Ничего не нашлось — впишите значения вручную ниже.
			</p>
		{:else}
			<!--
				Показываем калорийность сразу в списке: выбор «овсянка» вслепую
				ничем не лучше ручного ввода, а «88 ккал / 100 г» — уже ответ.
			-->
			<ul class="mt-2 flex flex-col gap-1">
				{#each matches as food (food.id)}
					{@const per100 = nutritionForGrams(food.per100g, 100)}
					<li>
						<button
							type="button"
							onclick={() => pick(food)}
							class="flex w-full items-center gap-3 rounded-xl border border-line/70
							       bg-white/[0.02] px-3 py-2.5 text-left transition-[transform,border-color]
							       duration-500 ease-flux hover:border-lavender/60 active:scale-[0.98]"
						>
							<span class="min-w-0 flex-1 truncate text-sm">{food.name}</span>
							<span class="tabular shrink-0 text-xs text-muted-foreground">
								{formatNumber(per100.calories)} ккал / 100 г
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
