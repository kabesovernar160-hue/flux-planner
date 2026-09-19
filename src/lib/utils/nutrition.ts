import type { DailyNutrition, FoodEntry } from '$lib/types/nutrition';
import { progressRatio } from './progress';

export interface MacroTotals {
	calories: number;
	protein: number;
	fat: number;
	carbs: number;
}

export interface MacroProgress {
	calories: number;
	protein: number;
	fat: number;
	carbs: number;
}

export interface NutritionSummary {
	date: string;
	totals: MacroTotals;
	goals: MacroTotals;
	/** Проценты. Могут превышать 100 при переборе. */
	progress: MacroProgress;
	caloriesRemaining: number;
	isOverGoal: boolean;
	water: {
		consumedMl: number;
		goalMl: number;
		progress: number;
		remainingMl: number;
	};
	entryCount: number;
}

// Формулы прогресса живут в utils/progress: те же вычисления нужны финансам,
// и две независимые реализации рано или поздно разойдутся в обработке нуля.
export { progressRatio, toPercent, clampProgress } from './progress';

/** Остаток. Отрицательный при переборе — это валидный результат, не ошибка. */
export function calculateCaloriesRemaining(consumed: number, goal: number): number {
	const safeConsumed = Number.isFinite(consumed) ? consumed : 0;
	const safeGoal = Number.isFinite(goal) ? goal : 0;
	return safeGoal - safeConsumed;
}

export function calculateCalorieProgress(consumed: number, goal: number): number {
	return progressRatio(consumed, goal) * 100;
}

export function calculateWaterProgress(consumedMl: number, goalMl: number): number {
	return progressRatio(consumedMl, goalMl) * 100;
}

const EMPTY_TOTALS: MacroTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };

/**
 * Суммы по записям.
 *
 * Нечисловые значения отдельных полей пропускаются, а не обнуляют весь итог:
 * одна битая запись не должна стирать посчитанный день.
 */
export function calculateMacroTotals(entries: FoodEntry[]): MacroTotals {
	if (!Array.isArray(entries) || entries.length === 0) return { ...EMPTY_TOTALS };

	return entries.reduce<MacroTotals>(
		(totals, entry) => ({
			calories: totals.calories + (Number.isFinite(entry?.calories) ? entry.calories : 0),
			protein: totals.protein + (Number.isFinite(entry?.protein) ? entry.protein : 0),
			fat: totals.fat + (Number.isFinite(entry?.fat) ? entry.fat : 0),
			carbs: totals.carbs + (Number.isFinite(entry?.carbs) ? entry.carbs : 0)
		}),
		{ ...EMPTY_TOTALS }
	);
}

export function calculateMacroProgress(totals: MacroTotals, goals: MacroTotals): MacroProgress {
	return {
		calories: calculateCalorieProgress(totals.calories, goals.calories),
		protein: progressRatio(totals.protein, goals.protein) * 100,
		fat: progressRatio(totals.fat, goals.fat) * 100,
		carbs: progressRatio(totals.carbs, goals.carbs) * 100
	};
}

/** Полная сводка дня — один вызов вместо десяти отдельных. */
export function calculateNutritionSummary(
	entries: FoodEntry[],
	nutrition: DailyNutrition
): NutritionSummary {
	const totals = calculateMacroTotals(entries);
	const goals: MacroTotals = {
		calories: nutrition.calorieGoal,
		protein: nutrition.proteinGoal,
		fat: nutrition.fatGoal,
		carbs: nutrition.carbsGoal
	};

	return {
		date: nutrition.date,
		totals,
		goals,
		progress: calculateMacroProgress(totals, goals),
		caloriesRemaining: calculateCaloriesRemaining(totals.calories, goals.calories),
		isOverGoal: totals.calories > goals.calories,
		water: {
			consumedMl: nutrition.waterConsumedMl,
			goalMl: nutrition.waterGoalMl,
			progress: calculateWaterProgress(nutrition.waterConsumedMl, nutrition.waterGoalMl),
			remainingMl: Math.max(0, nutrition.waterGoalMl - nutrition.waterConsumedMl)
		},
		entryCount: entries.length
	};
}
