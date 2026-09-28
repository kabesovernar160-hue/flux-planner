<script lang="ts">
	import { CaretDown, CaretRight, Drop, ForkKnife, Minus, Plus } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import MacroBar from '$lib/components/ui/macro-bar.svelte';
	import ScanButton from '$lib/components/brand/scan-button.svelte';
	import FoodList from '$lib/components/nutrition/food-list.svelte';
	import { addWater, removeWater, WATER_GLASS_ML } from '$lib/services/nutritionService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { formatNumber } from '$lib/utils/format';
	import { MEAL_LABELS, resolveMeal } from '$lib/utils/meals';

	const goals = $derived(plannerStore.todayNutrition);
	const entries = $derived(plannerStore.todayFoods);

	/**
	 * Дневник на главной — последние записи, а не весь день.
	 *
	 * Главная отвечает на вопрос «как мой день», и пятнадцать строк еды
	 * выталкивали привычки и деньги за третий экран. В свёрнутом виде —
	 * три последние записи тонкими строками; нажатие по любой или по
	 * «ещё N» раскрывает полный дневник с правкой, избранным и удалением.
	 *
	 * Свёрнутый список намеренно не разложен по приёмам: сумма приёма
	 * над частью его записей показывала бы не ту цифру.
	 */
	const PREVIEW = 3;
	let expanded = $state(false);

	const recent = $derived(
		[...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, PREVIEW)
	);
	const hiddenCount = $derived(entries.length - recent.length);
	const timeZone = $derived(plannerStore.doc.user.timezone);

	/**
	 * Вода стаканами: десяток отрезков считывается быстрее, чем «1,4/2,5 л»,
	 * и каждый тап по «+» закрашивает ровно один отрезок.
	 */
	const glassesGoal = $derived(Math.max(1, Math.round(goals.waterGoalMl / WATER_GLASS_ML)));
	const glassesDone = $derived(Math.floor(goals.waterConsumedMl / WATER_GLASS_ML));
	const segmentedWater = $derived(glassesGoal <= 12);

	const litres = (ml: number) => formatNumber(Math.round(ml / 100) / 10);

	function pourWater() {
		telegram.haptic.impact('light');
		addWater(WATER_GLASS_ML);
	}

	function undoWater() {
		telegram.haptic.selection();
		removeWater(WATER_GLASS_ML);
	}

	function toggleList() {
		telegram.haptic.selection();
		expanded = !expanded;
	}

	function expandList() {
		telegram.haptic.impact('light');
		expanded = true;
	}
</script>

<GlassCard tone="amber" id="nutrition-card">
	<!-- Стрелка обещает переход, поэтому заголовок ведёт в аналитику питания. -->
	<a href="/analytics" class="flex items-center gap-2">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<ForkKnife size={15} weight="regular" class="text-tone" />
		</span>
		<h2 class="flex-1 text-sm font-medium">Питание</h2>
		<!-- Большое число живёт в плитке над карточками — здесь только итог строкой. -->
		<span class="tabular text-xs text-muted-foreground">
			<span class="text-foreground">{formatNumber(plannerStore.caloriesConsumed)}</span>
			/ {formatNumber(goals.calorieGoal)} ккал
		</span>
		<CaretRight size={14} weight="light" class="text-muted-foreground" />
	</a>

	<!-- Три колонки вместо трёх строк: те же полосы, в три раза меньше высоты. -->
	<div class="mt-4 grid grid-cols-3 gap-3">
		<MacroBar
			label="Белки"
			current={plannerStore.proteinConsumed}
			goal={goals.proteinGoal}
			unit="г"
			stacked
			tone={0}
		/>
		<MacroBar
			label="Жиры"
			current={plannerStore.fatConsumed}
			goal={goals.fatGoal}
			unit="г"
			stacked
			tone={1}
		/>
		<MacroBar
			label="Углеводы"
			current={plannerStore.carbsConsumed}
			goal={goals.carbsGoal}
			unit="г"
			stacked
			tone={2}
		/>
	</div>

	<!--
		Вода — показ и действие в одной строке. Полоса сама не кнопка:
		тап по ней был бы неочевидным способом добавить стакан, поэтому
		рядом две явные круглые кнопки.
	-->
	<div class="mt-4 flex items-center gap-3">
		<Drop size={16} weight="light" class="shrink-0 text-tone" />
		<div class="min-w-0 flex-1">
			<div class="mb-1.5 flex items-baseline justify-between gap-2">
				<span class="text-[11px] text-muted-foreground">Вода</span>
				<span class="tabular text-[11px] font-medium">
					{litres(goals.waterConsumedMl)}<span class="text-muted-foreground"
						>/{litres(goals.waterGoalMl)} л</span
					>
				</span>
			</div>
			{#if segmentedWater}
				<div class="flex gap-1" aria-hidden="true">
					{#each { length: glassesGoal }, index (index)}
						<span
							class="h-1.5 flex-1 rounded-full transition-colors duration-400 ease-flux
							       {index < glassesDone ? 'bg-tone opacity-60' : 'bg-line'}"
						></span>
					{/each}
				</div>
			{:else}
				<div class="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
					<div
						class="h-full origin-left rounded-full bg-tone opacity-60 transition-transform duration-500 ease-flux"
						style="transform: scaleX({Math.min(1, glassesDone / glassesGoal)});"
					></div>
				</div>
			{/if}
		</div>
		<button
			type="button"
			onclick={undoWater}
			aria-label="Убрать стакан воды"
			disabled={goals.waterConsumedMl === 0}
			class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
			       text-muted-foreground transition-transform duration-500 ease-flux active:scale-90
			       disabled:pointer-events-none disabled:opacity-35"
		>
			<Minus size={13} weight="bold" />
		</button>
		<button
			type="button"
			onclick={pourWater}
			aria-label="Стакан воды · {WATER_GLASS_ML} мл"
			class="grid size-10 shrink-0 place-items-center rounded-full border border-tone/40
			       bg-tone/12 text-tone transition-transform duration-500 ease-flux active:scale-90"
		>
			<Plus size={14} weight="bold" />
		</button>
	</div>

	<div class="mt-4">
		<ScanButton onclick={() => ui.openFoodSheet()} />
	</div>

	<!--
		Дневник встроен сюда же: отдельной карточкой такой же формы он был
		лишним повтором. Пустой день его не показывает — «ничего не записано»
		под кнопкой «Сканировать еду» ничего не добавляло.
	-->
	{#if entries.length > 0}
		<div class="mt-4 border-t border-line/70 pt-4">
			<div class="mb-1 flex min-h-8 items-center gap-2">
				<h3 class="flex-1 text-sm font-medium">Что съедено</h3>
				<button
					type="button"
					onclick={toggleList}
					aria-expanded={expanded}
					class="-mr-2 flex h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground
					       transition-colors duration-400 ease-flux hover:text-foreground"
				>
					<span class="tabular">
						{expanded ? 'Свернуть' : hiddenCount > 0 ? `Ещё ${hiddenCount}` : 'Изменить'}
					</span>
					<CaretDown
						size={12}
						weight="light"
						class="transition-transform duration-400 ease-flux {expanded ? 'rotate-180' : ''}"
					/>
				</button>
			</div>

			{#if expanded}
				<div class="pt-1">
					<FoodList {entries} />
				</div>
			{:else}
				<!--
					Тонкие строки без кнопок: звёздочка и корзина в предпросмотре
					удваивали высоту каждой записи. Они в полном дневнике —
					одно нажатие по строке.
				-->
				<ul class="divide-y divide-line/60">
					{#each recent as entry (entry.id)}
						<li>
							<button
								type="button"
								onclick={expandList}
								class="flex w-full items-center gap-3 py-2.5 text-left transition-transform
								       duration-500 ease-flux active:scale-[0.99]"
							>
								<span class="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
								<span class="shrink-0 text-[11px] text-muted-foreground">
									{MEAL_LABELS[resolveMeal(entry, timeZone)]}
								</span>
								<span class="tabular w-16 shrink-0 text-right text-sm font-medium">
									{formatNumber(entry.calories)}<span
										class="ml-0.5 text-[11px] font-normal text-muted-foreground">ккал</span
									>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</GlassCard>
