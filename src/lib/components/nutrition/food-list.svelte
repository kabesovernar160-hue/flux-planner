<script lang="ts">
	import { Camera, Star, Trash } from 'phosphor-svelte';
	import Sheet from '$lib/components/ui/sheet.svelte';
	import FoodForm from './food-form.svelte';
	import { removeFood, toggleFavoriteFood } from '$lib/services/nutritionService';
	import { activeFavorites, favoriteKey } from '$lib/utils/favorites';
	import type { FoodEntry } from '$lib/types/nutrition';
	import { telegram } from '$lib/telegram';
	import { formatNumber } from '$lib/utils/format';
	import { groupByMeal } from '$lib/utils/meals';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';

	type Props = {
		entries: FoodEntry[];
		/** Показывать ли подсказку, когда записей нет. */
		empty?: string;
	};

	let { entries, empty = 'Сегодня пока ничего не записано.' }: Props = $props();

	/**
	 * Правка открывается шторкой с той же формой, что и ручное добавление.
	 * Отдельный экран правки означал бы вторую реализацию тех же полей
	 * и тех же проверок.
	 */
	let editing = $state<FoodEntry | null>(null);

	/**
	 * Записи разложены по приёмам пищи.
	 *
	 * Плоский список из пятнадцати строк отвечает только на вопрос «сколько
	 * всего», а человек смотрит в дневник, чтобы понять, где перебрал.
	 * Пустые приёмы не показываются.
	 */
	const groups = $derived(groupByMeal(entries, plannerStore.doc.user.timezone));

	/** Звёздочка по названию: «Овсянка» в избранном — это любая овсянка из дневника. */
	const favoriteKeys = $derived(
		new Set(activeFavorites(plannerStore.doc.settings.favoriteFoods).map((item) => item.key))
	);

	function star(entry: FoodEntry) {
		const on = toggleFavoriteFood(entry);
		telegram.haptic.impact(on ? 'medium' : 'light');
	}

	function remove(entry: FoodEntry) {
		telegram.haptic.impact('medium');
		removeFood(entry.id);
	}
</script>

{#if entries.length === 0}
	<p class="py-2 text-sm text-muted-foreground">{empty}</p>
{:else}
	{#each groups as group (group.meal)}
		<div class="mt-3 mb-1.5 flex items-baseline gap-2 first:mt-0">
			<h3 class="text-xs font-medium text-muted-foreground">{group.label}</h3>
			<span class="tabular text-[11px] text-muted-foreground/70">
				{formatNumber(group.calories)} ккал
			</span>
		</div>

		<ul class="flex flex-col gap-1.5">
			{#each group.entries as entry (entry.id)}
				{@const starred = favoriteKeys.has(favoriteKey(entry.name))}
				<!--
					Правка открывается нажатием на всю строку: мишень в полширины
					экрана удобнее двух кружков, а место под кнопками уходит
					на цифры, которые без него переносились на вторую строку.
				-->
				<li class="flex items-center rounded-xl border border-line/70 bg-white/[0.02]">
					<button
						type="button"
						onclick={() => {
							telegram.haptic.impact('light');
							editing = entry;
						}}
						aria-label="Изменить {entry.name}"
						class="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left
						       transition-transform duration-500 ease-flux active:scale-[0.98]"
					>
						<div class="min-w-0 flex-1">
							<p class="flex items-center gap-1.5 text-sm font-medium">
								{#if entry.source === 'ai'}
									<!-- Помечаем оценку по фото: её точность иная, чем у введённой руками. -->
									<Camera size={13} weight="light" class="shrink-0 text-muted-foreground" />
								{/if}
								<span class="truncate">{entry.name}</span>
							</p>
							<p class="tabular mt-0.5 truncate text-xs text-muted-foreground">
								{#if entry.grams}{formatNumber(entry.grams)} г ·{/if}
								Б {formatNumber(entry.protein)} · Ж {formatNumber(entry.fat)} · У {formatNumber(
									entry.carbs
								)}
							</p>
						</div>
						<span class="tabular shrink-0 text-sm font-semibold">
							{formatNumber(entry.calories)}<span
								class="ml-0.5 text-[11px] font-normal text-muted-foreground">ккал</span
							>
						</span>
					</button>

					<button
						type="button"
						onclick={() => star(entry)}
						aria-label={starred
							? `Убрать «${entry.name}» из избранного`
							: `В избранное «${entry.name}»`}
						aria-pressed={starred}
						class="tone-amber grid size-10 shrink-0 place-items-center transition-transform
						       duration-500 ease-flux active:scale-90"
					>
						<Star
							size={15}
							weight={starred ? 'fill' : 'light'}
							class={starred ? 'text-tone' : 'text-muted-foreground/50'}
						/>
					</button>

					<button
						type="button"
						onclick={() => remove(entry)}
						aria-label="Удалить {entry.name}"
						class="grid size-10 shrink-0 place-items-center text-muted-foreground/70
						       transition-[color,scale] duration-500 ease-flux hover:text-foreground active:scale-90"
					>
						<Trash size={15} weight="light" />
					</button>
				</li>
			{/each}
		</ul>
	{/each}
{/if}

<Sheet open={editing !== null} title="Изменить запись" onclose={() => (editing = null)}>
	{#if editing}
		<!--
			key по идентификатору: форма снимает начальные значения один раз,
			и без пересоздания при смене записи в полях остались бы данные
			предыдущего блюда.
		-->
		{#key editing.id}
			<FoodForm
				entry={editing}
				onsaved={() => (editing = null)}
				oncancel={() => (editing = null)}
			/>
		{/key}
	{/if}
</Sheet>
