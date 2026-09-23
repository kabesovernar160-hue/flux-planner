<script lang="ts">
	import { BowlFood, CaretRight, ForkKnife, Minus, Plus } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import MacroBar from '$lib/components/ui/macro-bar.svelte';
	import ScanButton from '$lib/components/brand/scan-button.svelte';
	import FoodLogWidget from './food-log-widget.svelte';
	import { addWater, removeWater, WATER_GLASS_ML } from '$lib/services/nutritionService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { formatNumber } from '$lib/utils/format';

	const goals = $derived(plannerStore.todayNutrition);
	const entries = $derived(plannerStore.todayFoods);

	function pourWater() {
		telegram.haptic.impact('light');
		addWater(WATER_GLASS_ML);
	}

	function undoWater() {
		telegram.haptic.selection();
		removeWater(WATER_GLASS_ML);
	}
</script>

<GlassCard tone="amber" id="nutrition-card">
	<!-- Стрелка обещает переход, поэтому заголовок ведёт в аналитику питания. -->
	<a href="/analytics" class="mb-1 flex items-center gap-2">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<ForkKnife size={15} weight="regular" class="text-tone" />
		</span>
		<h2 class="flex-1 text-sm font-medium">Калории и питание</h2>
		<CaretRight size={14} weight="light" class="text-muted-foreground" />
	</a>

	<!-- Большое число теперь живёт в плитке над карточками — здесь только итог. -->
	<p class="tabular mt-0.5 text-xs text-muted-foreground">
		{formatNumber(plannerStore.caloriesConsumed)} / {formatNumber(goals.calorieGoal)} ккал
	</p>

	<div class="mt-4 flex flex-col gap-3">
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
			       hover:border-tone/60 active:scale-[0.98]"
		>
			<Plus size={13} weight="bold" class="text-tone" />
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

	<!-- Дневник еды встроен сюда же: отдельной карточкой такой же формы он был лишним повтором. -->
	<div class="mt-4 border-t border-line/70 pt-4">
		<div class="mb-3 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<BowlFood size={15} weight="regular" class="text-tone" />
			</span>
			<h3 class="flex-1 text-sm font-medium">Что съедено</h3>
			{#if entries.length > 0}
				<span class="tabular text-xs text-muted-foreground">{entries.length}</span>
			{/if}
		</div>
		<FoodLogWidget />
	</div>
</GlassCard>
