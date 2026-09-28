<script lang="ts">
	import {
		ArrowCounterClockwise,
		CaretRight,
		CheckCircle,
		ForkKnife,
		ListChecks,
		Plus,
		Scales,
		Wallet
	} from 'phosphor-svelte';
	import type { Component } from 'svelte';
	import GlassCard from '$lib/components/ui/glass-card/glass-card.svelte';
	import Sheet from '$lib/components/ui/sheet.svelte';
	import {
		logFoodWithUndo,
		pluralDishes,
		repeatMealWithUndo
	} from '$lib/components/nutrition/quick-log';
	import type { FoodSnapshot } from '$lib/services/nutritionService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import {
		foodKey,
		frequentFoods,
		yesterdayMeals,
		type FrequentFood,
		type MealRepeat
	} from '$lib/utils/foodHistory';
	import { formatNumber, formatWeight } from '$lib/utils/format';
	import { mealForTime } from '$lib/utils/meals';

	/**
	 * «Что добавить».
	 *
	 * Сверху — то, что записывается в два касания без всякой формы: вчерашний
	 * приём и самые частые блюда. Ниже — плитки разделов, каждая в своём тоне:
	 * цвет находит нужную раньше, чем прочитана подпись. Еда — первой и во всю
	 * ширину: её записывают по нескольку раз в день, всё остальное — реже.
	 */

	type Tone = 'amber' | 'mint' | 'sky' | undefined;

	type Option = {
		label: string;
		hint: string;
		icon: Component;
		tone: Tone;
		open: () => void;
	};

	const timeZone = $derived(plannerStore.doc.user.timezone);

	/**
	 * Приём пищи на момент открытия. Считается от открытия, а не от загрузки
	 * страницы: приложение могли оставить открытым с утра.
	 */
	const meal = $derived(ui.createSheetOpen ? mealForTime(new Date(), timeZone) : 'snack');

	const todayWeight = $derived(plannerStore.getWeight(plannerStore.currentDate));

	const FOOD: Option = {
		label: 'Еда',
		hint: 'Фото, из недавнего или вручную',
		icon: ForkKnife,
		tone: 'amber',
		open: () => ui.openFoodSheet()
	};

	const OPTIONS = $derived<Option[]>([
		{
			label: 'Трата',
			hint: 'Сумма и категория',
			icon: Wallet,
			tone: 'sky',
			open: () => ui.openFinanceSheet()
		},
		{
			label: 'Привычка',
			hint: 'Название и расписание',
			icon: CheckCircle,
			tone: 'mint',
			open: () => ui.openHabitSheet()
		},
		{
			label: 'Вес',
			hint: todayWeight
				? `Сегодня ${formatWeight(todayWeight.weightKg)} кг`
				: 'Записать за сегодня',
			icon: Scales,
			tone: undefined,
			open: () => ui.openWeightSheet()
		},
		{
			label: 'Дело',
			hint: 'Время и тип',
			icon: ListChecks,
			tone: undefined,
			open: () => ui.openPlanSheet()
		}
	]);

	/**
	 * Один повтор, а не все вчерашние приёмы: вечером кнопка «вчерашний
	 * завтрак» только мешает. Сначала — приём по времени суток; если он
	 * сегодня уже записан или вчера пустовал, — первый из оставшихся.
	 */
	const repeat = $derived.by<MealRepeat | null>(() => {
		const all = yesterdayMeals(plannerStore.foodEntries, plannerStore.currentDate, timeZone);
		return all.find((item) => item.meal === meal) ?? all[0] ?? null;
	});

	/** Сколько частых блюд показывать: три строки — ещё «быстро», пять — уже список. */
	const QUICK_LIMIT = 3;

	/**
	 * Частые блюда.
	 *
	 * Сначала — частое именно в этот приём: утром овсянка, вечером гречка.
	 * Пока история короткая и своих блюд у приёма нет, добираем общим частым,
	 * иначе в первую неделю ряд был бы пустым.
	 */
	const quick = $derived.by<FrequentFood[]>(() => {
		const end = plannerStore.currentDate;
		const entries = plannerStore.foodEntries;
		const picked = frequentFoods(entries, { end, days: 30, limit: QUICK_LIMIT, meal, timeZone });
		if (picked.length >= QUICK_LIMIT) return picked;

		const seen = new Set(picked.map((food) => foodKey(food.name)));
		for (const food of frequentFoods(entries, { end, days: 30, limit: QUICK_LIMIT * 2 })) {
			if (picked.length >= QUICK_LIMIT) break;
			if (seen.has(foodKey(food.name))) continue;
			seen.add(foodKey(food.name));
			picked.push(food);
		}
		return picked;
	});

	const hasQuick = $derived(repeat !== null || quick.length > 0);

	function logFood(food: FoodSnapshot) {
		// Запись не прошла проверку (испорченная старая запись) — открываем
		// шторку еды: там форма покажет, что не так.
		if (logFoodWithUndo(food, meal)) ui.closeCreateSheet();
		else ui.openFoodSheet();
	}

	function repeatMeal(item: MealRepeat) {
		if (repeatMealWithUndo(item)) ui.closeCreateSheet();
	}

	const ROW =
		'flex w-full items-center gap-3 px-3.5 py-3 text-left transition-[transform,background-color] ' +
		'duration-500 ease-flux hover:bg-white/[0.03] active:scale-[0.98]';
</script>

{#snippet chip(Icon: Component, size: string)}
	<span class="grid {size} shrink-0 place-items-center rounded-lg bg-tone/12">
		<Icon size={19} weight="regular" class="text-tone" />
	</span>
{/snippet}

<Sheet open={ui.createSheetOpen} title="Что добавить" onclose={() => ui.closeCreateSheet()}>
	<div class="flex flex-col gap-4 py-1">
		{#if hasQuick}
			<!--
				Быстрая запись. Касание — сразу в дневник, без формы; ошибка
				исправляется «Отменить» в тосте, а не вопросом «вы уверены?».
			-->
			<section class="tone-amber" aria-label="Быстрая запись">
				<h3 class="mb-2 px-1 text-xs text-muted-foreground">В два касания</h3>

				<ul
					class="divide-y divide-line/60 overflow-hidden rounded-card border border-tone/20
					       bg-tone/[0.04]"
				>
					{#if repeat}
						<li>
							<button type="button" onclick={() => repeatMeal(repeat)} class={ROW}>
								{@render chip(ArrowCounterClockwise, 'size-9')}
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium">Повторить {repeat.label}</span>
									<span class="tabular block text-xs text-muted-foreground">
										{repeat.items.length}
										{pluralDishes(repeat.items.length)} · {formatNumber(
											Math.round(repeat.calories)
										)} ккал
									</span>
								</span>
							</button>
						</li>
					{/if}

					{#each quick as food (foodKey(food.name))}
						<li>
							<button
								type="button"
								onclick={() => logFood(food)}
								aria-label="Записать {food.name}"
								class={ROW}
							>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm">{food.name}</span>
									<span class="tabular block text-xs text-muted-foreground">
										{#if food.grams}{formatNumber(food.grams)} г ·{/if}
										{formatNumber(Math.round(food.calories))} ккал
									</span>
								</span>
								<!-- Плюс, а не шеврон: касание записывает сразу, а не открывает экран. -->
								<span
									aria-hidden="true"
									class="grid size-8 shrink-0 place-items-center rounded-full border border-tone/30
									       text-tone"
								>
									<Plus size={14} weight="bold" />
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<div class="grid grid-cols-2 gap-2.5">
			<!-- Еда — во всю ширину: самая частая запись дня. -->
			<GlassCard tone="amber" padding="sm" onclick={FOOD.open} class="col-span-2">
				<span class="flex items-center gap-3.5">
					{@render chip(FOOD.icon, 'size-11')}
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-medium">{FOOD.label}</span>
						<span class="block truncate text-xs text-muted-foreground">{FOOD.hint}</span>
					</span>
					<CaretRight size={16} weight="light" class="shrink-0 text-muted-foreground" />
				</span>
			</GlassCard>

			{#each OPTIONS as option (option.label)}
				<GlassCard tone={option.tone} padding="sm" onclick={option.open}>
					<span class="flex flex-col gap-3">
						{@render chip(option.icon, 'size-10')}
						<span class="min-w-0">
							<span class="block text-sm font-medium">{option.label}</span>
							<span class="block truncate text-xs text-muted-foreground">{option.hint}</span>
						</span>
					</span>
				</GlassCard>
			{/each}
		</div>
	</div>
</Sheet>
