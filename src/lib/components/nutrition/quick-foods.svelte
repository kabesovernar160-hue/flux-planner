<script lang="ts">
	import { ArrowCounterClockwise, PencilSimple, Star } from 'phosphor-svelte';
	import {
		quickLogFood,
		repeatMeal,
		toggleFavoriteFood,
		undoFoodEntries,
		type FoodSnapshot
	} from '$lib/services/nutritionService';
	import { toast } from '$lib/state/toast.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { activeFavorites, favoriteKey } from '$lib/utils/favorites';
	import {
		frequentFoods,
		recentFoods,
		yesterdayMeals,
		type MealRepeat
	} from '$lib/utils/foodHistory';
	import { formatNumber } from '$lib/utils/format';
	import type { MealType } from '$lib/utils/meals';

	type Props = {
		/** Приём, в который уходит быстрая запись. */
		meal: MealType;
		/** Запись сделана — вызывающий закрывает шторку. */
		onlogged: () => void;
		/** Открыть блюдо в форме: поправить порцию перед записью. */
		onedit: (food: FoodSnapshot) => void;
	};

	let { meal, onlogged, onedit }: Props = $props();

	type Tab = 'frequent' | 'recent' | 'favorites';

	/** Строк в списке: пять помещаются над камерой, не сдвигая её за край экрана. */
	const LIMIT = 5;

	const end = $derived(plannerStore.currentDate);
	const frequent = $derived(
		frequentFoods(plannerStore.foodEntries, { end, days: 30, limit: LIMIT })
	);
	const recent = $derived(recentFoods(plannerStore.foodEntries, { end, limit: LIMIT }));
	const favorites = $derived(activeFavorites(plannerStore.doc.settings.favoriteFoods));
	const favoriteKeys = $derived(new Set(favorites.map((item) => item.key)));
	const repeats = $derived(
		yesterdayMeals(plannerStore.foodEntries, end, plannerStore.doc.user.timezone)
	);

	/**
	 * Вкладка по умолчанию.
	 *
	 * «Часто» — только когда есть что-то повторявшееся: в первую неделю частого
	 * ещё нет, и первым показать стоит вчерашнее, а не список единичных записей
	 * в случайном порядке.
	 */
	let chosen = $state<Tab | null>(null);
	const tab = $derived<Tab>(
		chosen ?? (frequent.some((food) => food.count > 1) ? 'frequent' : 'recent')
	);

	const items = $derived<FoodSnapshot[]>(
		tab === 'frequent' ? frequent : tab === 'recent' ? recent : favorites.slice(0, 8)
	);

	const TABS: [Tab, string][] = [
		['frequent', 'Часто'],
		['recent', 'Недавно'],
		['favorites', 'Избранное']
	];

	const visible = $derived(recent.length > 0 || favorites.length > 0);

	function pickTab(next: Tab) {
		telegram.haptic.selection();
		chosen = next;
	}

	function log(food: FoodSnapshot) {
		const result = quickLogFood(food, meal);

		if (!result.ok) {
			// Испорченная старая запись — открываем форму: там видно, что не так.
			onedit(food);
			return;
		}

		telegram.haptic.notification('success');
		const id = result.value.id;
		toast.show(`Записано · ${food.name}`, {
			label: 'Отменить',
			run: () => undoFoodEntries([id])
		});
		onlogged();
	}

	function repeat(item: MealRepeat) {
		const result = repeatMeal(item.items, item.meal);
		if (!result.ok) return;

		telegram.haptic.notification('success');
		const ids = result.value.map((entry) => entry.id);
		const count = ids.length;
		toast.show(
			`Повторён ${item.label.replace('вчерашний ', '')} · ${count} ${count === 1 ? 'блюдо' : count < 5 ? 'блюда' : 'блюд'}`,
			{ label: 'Отменить', run: () => undoFoodEntries(ids) }
		);
		onlogged();
	}

	function star(food: FoodSnapshot) {
		const on = toggleFavoriteFood(food);
		telegram.haptic.impact(on ? 'medium' : 'light');
	}

	/**
	 * Долгое нажатие — править порцию, короткое — записать.
	 *
	 * Касание остаётся главным жестом: это и есть «два тапа». Долгое нажатие
	 * — для тех, кто знает; для остальных рядом карандаш с тем же действием.
	 */
	const LONG_PRESS_MS = 450;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressed = false;

	function pressStart(food: FoodSnapshot) {
		longPressed = false;
		pressTimer = setTimeout(() => {
			longPressed = true;
			telegram.haptic.impact('medium');
			onedit(food);
		}, LONG_PRESS_MS);
	}

	function pressEnd() {
		if (pressTimer) clearTimeout(pressTimer);
		pressTimer = null;
	}

	function tap(food: FoodSnapshot) {
		// Долгое нажатие уже открыло форму — отпускание пальца не должно
		// следом записать то же блюдо.
		if (longPressed) {
			longPressed = false;
			return;
		}
		log(food);
	}

	$effect(() => () => pressEnd());
</script>

{#if visible}
	<section class="tone-amber" aria-label="Быстрая запись">
		{#if repeats.length > 0}
			<!-- Вчерашний приём целиком: самый частый сценарий — «то же, что вчера». -->
			<div class="mb-3 flex flex-col gap-1.5">
				{#each repeats as item (item.meal)}
					<button
						type="button"
						onclick={() => repeat(item)}
						class="flex items-center gap-2.5 rounded-xl border border-tone/30 bg-tone/[0.07] px-3 py-2.5
						       text-left transition-[transform,border-color] duration-500 ease-flux
						       hover:border-tone/60 active:scale-[0.98]"
					>
						<ArrowCounterClockwise size={15} weight="regular" class="shrink-0 text-tone" />
						<span class="min-w-0 flex-1 truncate text-sm">Повторить {item.label}</span>
						<span class="tabular shrink-0 text-xs text-muted-foreground">
							{item.items.length} · {formatNumber(Math.round(item.calories))} ккал
						</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="flex gap-1 rounded-full border border-line/70 bg-white/[0.02] p-1" role="tablist">
			{#each TABS as [value, label] (value)}
				<button
					type="button"
					role="tab"
					aria-selected={tab === value}
					onclick={() => pickTab(value)}
					class="flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-xs font-medium
					       transition-colors duration-400 ease-flux
					       {tab === value ? 'bg-tone/15 text-tone' : 'text-muted-foreground'}"
				>
					{#if value === 'favorites'}
						<Star size={12} weight={tab === value ? 'fill' : 'regular'} />
					{/if}
					{label}
				</button>
			{/each}
		</div>

		{#if items.length === 0}
			<p class="mt-2.5 px-1 text-xs leading-relaxed text-muted-foreground">
				{tab === 'favorites'
					? 'Отметьте блюдо звёздочкой — здесь оно будет всегда под рукой.'
					: 'Здесь появится то, что вы записываете чаще всего.'}
			</p>
		{:else}
			<ul class="mt-2 flex flex-col gap-1">
				{#each items as food (favoriteKey(food.name))}
					{@const starred = favoriteKeys.has(favoriteKey(food.name))}
					<li class="flex items-center rounded-xl border border-line/70 bg-white/[0.02]">
						<button
							type="button"
							onclick={() => star(food)}
							aria-label={starred
								? `Убрать «${food.name}» из избранного`
								: `В избранное «${food.name}»`}
							aria-pressed={starred}
							class="grid size-10 shrink-0 place-items-center transition-transform duration-500
							       ease-flux active:scale-90"
						>
							<Star
								size={15}
								weight={starred ? 'fill' : 'light'}
								class={starred ? 'text-tone' : 'text-muted-foreground/60'}
							/>
						</button>

						<button
							type="button"
							onclick={() => tap(food)}
							onpointerdown={() => pressStart(food)}
							onpointerup={pressEnd}
							onpointerleave={pressEnd}
							onpointercancel={pressEnd}
							oncontextmenu={(event) => event.preventDefault()}
							aria-label="Записать {food.name}"
							class="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left transition-transform
							       duration-500 ease-flux select-none active:scale-[0.98]"
						>
							<span class="min-w-0 flex-1 truncate text-sm">{food.name}</span>
							<span class="tabular shrink-0 text-xs text-muted-foreground">
								{#if food.grams}{formatNumber(food.grams)} г ·{/if}
								{formatNumber(Math.round(food.calories))} ккал
							</span>
						</button>

						<button
							type="button"
							onclick={() => {
								telegram.haptic.impact('light');
								onedit(food);
							}}
							aria-label="Изменить порцию «{food.name}»"
							class="grid size-10 shrink-0 place-items-center text-muted-foreground
							       transition-transform duration-500 ease-flux active:scale-90"
						>
							<PencilSimple size={14} weight="light" />
						</button>
					</li>
				{/each}
			</ul>
			<p class="mt-1.5 px-1 text-[11px] text-muted-foreground/70">
				Касание — записать сразу, карандаш или долгое нажатие — изменить порцию
			</p>
		{/if}
	</section>
{/if}
