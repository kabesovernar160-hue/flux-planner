<script lang="ts">
	import { CaretRight, ForkKnife, Minus, Plus } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import ProgressRing from '$lib/components/ui/progress-ring.svelte';
	import MacroBar from '$lib/components/ui/macro-bar.svelte';
	import ScanButton from '$lib/components/brand/scan-button.svelte';
	import { addWater, removeWater, WATER_GLASS_ML } from '$lib/services/nutritionService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { formatNumber } from '$lib/utils/format';

	const goals = $derived(plannerStore.todayNutrition);

	// При переборе показываем величину перебора, а не отрицательный остаток:
	// «−120» на крупном счётчике читается хуже, чем «120 / Перебор».
	const headline = $derived(
		plannerStore.isOverCalorieGoal
			? plannerStore.caloriesConsumed - goals.calorieGoal
			: plannerStore.caloriesRemaining
	);

	function pourWater() {
		telegram.haptic.impact('light');
		addWater(WATER_GLASS_ML);
	}

	function undoWater() {
		telegram.haptic.selection();
		removeWater(WATER_GLASS_ML);
	}
</script>

<GlassCard>
	<div class="mb-1 flex items-center gap-2">
		<ForkKnife size={16} weight="light" class="text-lavender" />
		<h2 class="flex-1 text-sm font-medium">Калории и питание</h2>
		<CaretRight size={14} weight="light" class="text-muted-foreground" />
	</div>

	<div class="flex flex-col items-center py-3">
		<ProgressRing
			value={plannerStore.calorieProgress}
			over={plannerStore.isOverCalorieGoal}
			size={168}
		>
			<span class="tabular text-[2.75rem] leading-none font-semibold tracking-tight">
				{formatNumber(headline)}
			</span>
			<span class="mt-1.5 text-[11px] tracking-wide text-muted-foreground">
				{plannerStore.isOverCalorieGoal ? 'Перебор, ккал' : 'Осталось ккал'}
			</span>
		</ProgressRing>

		<p class="tabular mt-3 text-xs text-muted-foreground">
			{formatNumber(plannerStore.caloriesConsumed)} из {formatNumber(goals.calorieGoal)} ккал
		</p>
	</div>

	<!--
		2×2, а не 4 колонки: на 375px четыре колонки дают ~66px на макрос,
		и подпись со значением «82/120 г» перестаёт помещаться в строку.
	-->
	<div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-3.5">
		<MacroBar
			label="Белки"
			current={plannerStore.proteinConsumed}
			goal={goals.proteinGoal}
			unit="г"
			tone={0}
		/>
		<MacroBar
			label="Жиры"
			current={plannerStore.fatConsumed}
			goal={goals.fatGoal}
			unit="г"
			tone={1}
		/>
		<MacroBar
			label="Углеводы"
			current={plannerStore.carbsConsumed}
			goal={goals.carbsGoal}
			unit="г"
			tone={2}
		/>
		<!-- Вода хранится в миллилитрах, показывается в литрах. -->
		<MacroBar
			label="Вода"
			current={goals.waterConsumedMl / 1000}
			goal={goals.waterGoalMl / 1000}
			unit="л"
			tone={3}
		/>
	</div>

	<!--
		Показ воды живёт в сетке макросов, а действие — отдельной строкой.
		Полоса прогресса плохо читается как кнопка, и тап по ней был бы
		неочевидным способом добавить стакан.
	-->
	<div class="mt-4 flex items-center gap-2">
		<button
			type="button"
			onclick={pourWater}
			class="flex flex-1 items-center justify-center gap-2 rounded-full border border-line-strong
			       py-2.5 text-xs font-medium transition-[transform,border-color] duration-500 ease-flux
			       hover:border-lavender/60 active:scale-[0.98]"
		>
			<Plus size={13} weight="bold" class="text-lavender" />
			Стакан воды · {WATER_GLASS_ML} мл
		</button>
		<button
			type="button"
			onclick={undoWater}
			aria-label="Убрать стакан воды"
			disabled={goals.waterConsumedMl === 0}
			class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
			       transition-transform duration-500 ease-flux active:scale-90
			       disabled:pointer-events-none disabled:opacity-35"
		>
			<Minus size={13} weight="bold" />
		</button>
	</div>

	<div class="mt-4">
		<ScanButton onclick={() => ui.openFoodSheet()} />
	</div>
</GlassCard>
