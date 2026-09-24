import { plannerStore, type FoodEntryInput } from '$lib/stores/plannerStore.svelte';
import type { FoodEntry, FoodScanItem } from '$lib/types/nutrition';
import { nowIso, type DateKey } from '$lib/utils/date';
import { isFavorite, toggleFavorite } from '$lib/utils/favorites';
import { isMealType, mealForTime, type MealType } from '$lib/utils/meals';
import { calculateNutritionSummary, type NutritionSummary } from '$lib/utils/nutrition';

/** Стандартный стакан. */
export const WATER_GLASS_ML = 250;

/** Потолок на запись: страхует от опечатки вроде 50 000 ккал в одном блюде. */
const MAX_CALORIES = 20_000;
const MAX_MACRO_GRAMS = 5_000;
const MAX_PORTION_GRAMS = 20_000;

export type ServiceResult<T> =
	{ ok: true; value: T } | { ok: false; errors: Record<string, string> };

export type FoodDraft = {
	name: string;
	grams?: number;
	calories: number;
	protein: number;
	fat: number;
	carbs: number;
	source?: FoodEntry['source'];
	/** Приём пищи. Не указан — подбирается по времени суток. */
	meal?: MealType;
	date?: DateKey;
};

function isNonNegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Проверка черновика записи.
 *
 * Ошибки возвращаются словарём по полям, а не одной строкой: форме нужно
 * подсветить конкретное поле, а не показать общий текст над всей формой.
 */
export function validateFoodDraft(draft: Partial<FoodDraft>): Record<string, string> {
	const errors: Record<string, string> = {};

	if (typeof draft.name !== 'string' || draft.name.trim().length === 0) {
		errors.name = 'Укажите название';
	}

	const macros: [keyof FoodDraft, string, number][] = [
		['calories', 'Калории', MAX_CALORIES],
		['protein', 'Белки', MAX_MACRO_GRAMS],
		['fat', 'Жиры', MAX_MACRO_GRAMS],
		['carbs', 'Углеводы', MAX_MACRO_GRAMS]
	];

	for (const [field, label, max] of macros) {
		const value = draft[field];
		if (!isNonNegative(value)) {
			errors[field] = `${label}: нужно число не меньше нуля`;
		} else if (value > max) {
			errors[field] = `${label}: слишком большое значение`;
		}
	}

	// Вес порции необязателен, но если указан — он строго больше нуля:
	// «0 граммов» это не порция, а незаполненное поле.
	if (draft.grams !== undefined) {
		if (typeof draft.grams !== 'number' || !Number.isFinite(draft.grams) || draft.grams <= 0) {
			errors.grams = 'Вес порции должен быть больше нуля';
		} else if (draft.grams > MAX_PORTION_GRAMS) {
			errors.grams = 'Вес порции слишком большой';
		}
	}

	return errors;
}

export function addFood(draft: FoodDraft): ServiceResult<FoodEntry> {
	const errors = validateFoodDraft(draft);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	const input: FoodEntryInput = {
		name: draft.name.trim(),
		grams: draft.grams,
		calories: draft.calories,
		protein: draft.protein,
		fat: draft.fat,
		carbs: draft.carbs,
		source: draft.source ?? 'manual',
		// Приём подставляется по времени: спрашивать «завтрак или обед?»
		// в девять утра — лишний вопрос с очевидным ответом. Поправить
		// его можно в той же форме.
		meal: draft.meal ?? mealForTime(),
		date: draft.date
	};

	return { ok: true, value: plannerStore.addFoodEntry(input) };
}

/**
 * Перенос подтверждённого результата сканирования в дневник.
 *
 * Каждый компонент становится отдельной записью: «курица», «рис» и «овощи» —
 * это три разных продукта с разным весом, и если завтра пользователь захочет
 * убрать из дня только соус, он должен иметь такую возможность.
 *
 * Записи создаются ТОЛЬКО отсюда, то есть после явного подтверждения. Прямого
 * пути «распознали — сохранили» в приложении нет и быть не должно: оценка
 * по фотографии слишком приблизительна, чтобы попадать в дневник молча.
 *
 * Проверяются сразу все компоненты, и только потом добавляются: половина
 * сохранённого блюда хуже, чем понятная ошибка.
 */
export function addScannedFood(
	items: readonly FoodScanItem[],
	date?: DateKey,
	meal?: MealType
): ServiceResult<FoodEntry[]> {
	if (items.length === 0) return { ok: false, errors: { items: 'Нечего добавлять' } };

	// Приём один на всё блюдо: курица, рис и соус с одной фотографии
	// съедены за один раз, и раскладывать их по разным приёмам нелепо.
	const resolvedMeal = meal ?? mealForTime();

	const drafts: FoodDraft[] = items.map((item) => ({
		name: item.name,
		grams: item.estimatedGrams,
		calories: item.calories,
		protein: item.protein,
		fat: item.fat,
		carbs: item.carbs,
		source: 'ai',
		meal: resolvedMeal,
		date
	}));

	for (const draft of drafts) {
		const errors = validateFoodDraft(draft);
		if (Object.keys(errors).length > 0) {
			const [field, message] = Object.entries(errors)[0];
			return { ok: false, errors: { [field]: `${draft.name}: ${message}` } };
		}
	}

	const created = drafts.map((draft) =>
		plannerStore.addFoodEntry({
			name: draft.name.trim(),
			grams: draft.grams,
			calories: draft.calories,
			protein: draft.protein,
			fat: draft.fat,
			carbs: draft.carbs,
			source: 'ai',
			meal: draft.meal,
			date: draft.date
		})
	);

	return { ok: true, value: created };
}

export function updateFood(id: string, patch: Partial<FoodDraft>): ServiceResult<null> {
	const existing = plannerStore.foodEntries.find((entry) => entry.id === id);
	if (!existing) return { ok: false, errors: { id: 'Запись не найдена' } };

	// Проверяем итоговое состояние записи, а не только присланные поля:
	// правка одного поля не должна оставлять запись в недопустимом виде.
	const merged: FoodDraft = {
		name: patch.name ?? existing.name,
		grams: patch.grams ?? existing.grams,
		calories: patch.calories ?? existing.calories,
		protein: patch.protein ?? existing.protein,
		fat: patch.fat ?? existing.fat,
		carbs: patch.carbs ?? existing.carbs,
		meal: isMealType(patch.meal) ? patch.meal : existing.meal
	};

	const errors = validateFoodDraft(merged);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	plannerStore.updateFoodEntry(id, { ...merged, name: merged.name.trim() });
	return { ok: true, value: null };
}

export function removeFood(id: string): void {
	plannerStore.removeFoodEntry(id);
}

export function getFoodsForDate(date: DateKey): FoodEntry[] {
	return plannerStore.foodEntries.filter((entry) => entry.date === date);
}

/* ───────────────────────────── Вода ───────────────────────────── */

export function addWater(ml: number = WATER_GLASS_ML, date?: DateKey): void {
	plannerStore.addWater(ml, date ?? plannerStore.currentDate);
}

export function removeWater(ml: number = WATER_GLASS_ML, date?: DateKey): void {
	plannerStore.removeWater(ml, date ?? plannerStore.currentDate);
}

export function setWaterGoal(goalMl: number, date?: DateKey): void {
	plannerStore.setWaterGoal(goalMl, date ?? plannerStore.currentDate);
}

/* ───────────────────────────── Сводка ───────────────────────────── */

export function getNutritionSummary(date: DateKey = plannerStore.currentDate): NutritionSummary {
	const nutrition = plannerStore.doc.nutrition[date] ?? {
		date,
		calorieGoal: plannerStore.doc.settings.calorieGoal,
		proteinGoal: plannerStore.doc.settings.proteinGoal,
		fatGoal: plannerStore.doc.settings.fatGoal,
		carbsGoal: plannerStore.doc.settings.carbsGoal,
		waterGoalMl: plannerStore.doc.settings.waterGoalMl,
		waterConsumedMl: 0
	};

	return calculateNutritionSummary(getFoodsForDate(date), nutrition);
}

/* ───────────────── Быстрая запись ───────────────── */

/** Блюдо с готовой порцией: из частого, недавнего или избранного. */
export type FoodSnapshot = Pick<
	FoodEntry,
	'name' | 'grams' | 'calories' | 'protein' | 'fat' | 'carbs'
>;

/**
 * Записать блюдо одним касанием — с теми же граммами и цифрами.
 *
 * Без формы: человек выбирает то, что уже ел, и цифры уже проверены им
 * самим. Порцию при необходимости правят отдельно — долгим нажатием.
 */
export function quickLogFood(food: FoodSnapshot, meal?: MealType): ServiceResult<FoodEntry> {
	return addFood({
		name: food.name,
		grams: food.grams,
		calories: food.calories,
		protein: food.protein,
		fat: food.fat,
		carbs: food.carbs,
		meal
	});
}

/**
 * Повторить вчерашний приём пищи целиком.
 *
 * Записи копируются в выбранный день с тем же приёмом: вчерашний завтрак
 * становится сегодняшним завтраком, даже если кнопку нажали в полдень.
 */
export function repeatMeal(
	items: readonly FoodEntry[],
	meal: MealType,
	date: DateKey = plannerStore.currentDate
): ServiceResult<FoodEntry[]> {
	if (items.length === 0) return { ok: false, errors: { items: 'Нечего повторять' } };

	const drafts: FoodDraft[] = items.map((item) => ({
		name: item.name,
		grams: item.grams,
		calories: item.calories,
		protein: item.protein,
		fat: item.fat,
		carbs: item.carbs,
		source: item.source,
		meal,
		date
	}));

	// Сначала проверка всех, потом запись: половина повторённого завтрака
	// хуже, чем понятный отказ.
	for (const draft of drafts) {
		const errors = validateFoodDraft(draft);
		if (Object.keys(errors).length > 0) return { ok: false, errors };
	}

	return {
		ok: true,
		value: drafts.map((draft) =>
			plannerStore.addFoodEntry({
				name: draft.name.trim(),
				grams: draft.grams,
				calories: draft.calories,
				protein: draft.protein,
				fat: draft.fat,
				carbs: draft.carbs,
				source: draft.source ?? 'manual',
				meal: draft.meal,
				date: draft.date
			})
		)
	};
}

/** Отмена быстрой записи: удаляются ровно те записи, что она создала. */
export function undoFoodEntries(ids: readonly string[]): void {
	for (const id of ids) plannerStore.removeFoodEntry(id);
}

/** Поставить или снять звёздочку. Список живёт в настройках и синхронизируется. */
export function toggleFavoriteFood(food: FoodSnapshot): boolean {
	const next = toggleFavorite(plannerStore.doc.settings.favoriteFoods, food, nowIso());
	plannerStore.updateSettings({ favoriteFoods: next });
	return isFavorite(next, food.name);
}

export function isFavoriteFood(name: string): boolean {
	return isFavorite(plannerStore.doc.settings.favoriteFoods, name);
}
