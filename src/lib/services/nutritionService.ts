import { plannerStore, type FoodEntryInput } from '$lib/stores/plannerStore.svelte';
import type { FoodEntry, FoodScanItem } from '$lib/types/nutrition';
import type { DateKey } from '$lib/utils/date';
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
	date?: DateKey
): ServiceResult<FoodEntry[]> {
	if (items.length === 0) return { ok: false, errors: { items: 'Нечего добавлять' } };

	const drafts: FoodDraft[] = items.map((item) => ({
		name: item.name,
		grams: item.estimatedGrams,
		calories: item.calories,
		protein: item.protein,
		fat: item.fat,
		carbs: item.carbs,
		source: 'ai',
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
		carbs: patch.carbs ?? existing.carbs
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
