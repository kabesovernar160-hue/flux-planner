import { describe, expect, it } from 'vitest';
import type { FoodEntry } from '$lib/types/nutrition';
import {
	calculateCalorieProgress,
	calculateCaloriesRemaining,
	calculateMacroProgress,
	calculateMacroTotals,
	calculateNutritionSummary,
	calculateWaterProgress,
	clampProgress,
	progressRatio,
	toPercent
} from './nutrition';

const entry = (overrides: Partial<FoodEntry> = {}): FoodEntry => ({
	id: 'e1',
	date: '2026-01-15',
	name: 'Еда',
	calories: 100,
	protein: 10,
	fat: 5,
	carbs: 20,
	source: 'manual',
	createdAt: '2026-01-15T08:00:00.000Z',
	updatedAt: '2026-01-15T08:00:00.000Z',
	...overrides
});

describe('progressRatio', () => {
	it('считает обычную долю', () => {
		expect(progressRatio(50, 200)).toBe(0.25);
	});

	it('нулевая цель даёт 0, а не бесконечность', () => {
		expect(progressRatio(500, 0)).toBe(0);
		expect(Number.isFinite(progressRatio(500, 0))).toBe(true);
	});

	it('отрицательная цель даёт 0', () => {
		expect(progressRatio(500, -100)).toBe(0);
	});

	it('NaN и Infinity на входе дают 0', () => {
		expect(progressRatio(Number.NaN, 100)).toBe(0);
		expect(progressRatio(100, Number.NaN)).toBe(0);
		expect(progressRatio(Number.POSITIVE_INFINITY, 100)).toBe(0);
	});

	it('превышение цели даёт больше единицы', () => {
		expect(progressRatio(300, 200)).toBe(1.5);
	});
});

describe('toPercent и clampProgress', () => {
	it('переводит долю в проценты', () => {
		expect(toPercent(0.25)).toBe(25);
	});

	it('обрезает для отрисовки, но не искажает исходную величину', () => {
		expect(clampProgress(140)).toBe(100);
		expect(clampProgress(-20)).toBe(0);
		expect(clampProgress(Number.NaN)).toBe(0);
	});
});

describe('calculateCaloriesRemaining', () => {
	it('возвращает остаток', () => {
		expect(calculateCaloriesRemaining(1450, 2100)).toBe(650);
	});

	it('при переборе возвращает отрицательное — это валидный результат', () => {
		expect(calculateCaloriesRemaining(2400, 2100)).toBe(-300);
	});

	it('не ломается на нечисловых значениях', () => {
		expect(calculateCaloriesRemaining(Number.NaN, 2100)).toBe(2100);
		expect(Number.isFinite(calculateCaloriesRemaining(100, Number.NaN))).toBe(true);
	});
});

describe('calculateCalorieProgress', () => {
	it('считает проценты', () => {
		expect(calculateCalorieProgress(1050, 2100)).toBe(50);
	});

	it('нулевая цель даёт 0', () => {
		expect(calculateCalorieProgress(1050, 0)).toBe(0);
	});

	it('превышение даёт больше 100', () => {
		expect(calculateCalorieProgress(2400, 2000)).toBe(120);
	});
});

describe('calculateMacroTotals', () => {
	it('суммирует записи', () => {
		const totals = calculateMacroTotals([entry(), entry({ calories: 200, protein: 5 })]);

		expect(totals.calories).toBe(300);
		expect(totals.protein).toBe(15);
		expect(totals.fat).toBe(10);
		expect(totals.carbs).toBe(40);
	});

	it('пустой список даёт нули', () => {
		expect(calculateMacroTotals([])).toEqual({ calories: 0, protein: 0, fat: 0, carbs: 0 });
	});

	it('битое поле одной записи не обнуляет весь день', () => {
		const broken = entry({ calories: Number.NaN, protein: Number.POSITIVE_INFINITY });
		const totals = calculateMacroTotals([entry(), broken]);

		// Калории и белки битой записи пропущены, остальные её поля учтены.
		expect(totals.calories).toBe(100);
		expect(totals.protein).toBe(10);
		expect(totals.fat).toBe(10);
	});
});

describe('calculateMacroProgress', () => {
	it('считает проценты по каждому макросу', () => {
		const progress = calculateMacroProgress(
			{ calories: 1050, protein: 60, fat: 35, carbs: 115 },
			{ calories: 2100, protein: 120, fat: 70, carbs: 230 }
		);

		expect(progress.calories).toBe(50);
		expect(progress.protein).toBe(50);
		expect(progress.fat).toBe(50);
		expect(progress.carbs).toBe(50);
	});

	it('нулевые цели дают нули, а не NaN', () => {
		const progress = calculateMacroProgress(
			{ calories: 100, protein: 10, fat: 5, carbs: 20 },
			{ calories: 0, protein: 0, fat: 0, carbs: 0 }
		);

		expect(Object.values(progress).every((value) => value === 0)).toBe(true);
	});
});

describe('calculateNutritionSummary', () => {
	const nutrition = {
		date: '2026-01-15',
		calorieGoal: 2100,
		proteinGoal: 120,
		fatGoal: 70,
		carbsGoal: 230,
		waterGoalMl: 2500,
		waterConsumedMl: 1400
	};

	it('собирает полную сводку дня', () => {
		const summary = calculateNutritionSummary(
			[entry({ calories: 1450, protein: 82, fat: 48, carbs: 165 })],
			nutrition
		);

		expect(summary.totals.calories).toBe(1450);
		expect(summary.caloriesRemaining).toBe(650);
		expect(summary.isOverGoal).toBe(false);
		expect(summary.entryCount).toBe(1);
		expect(summary.water.progress).toBeCloseTo(56);
		expect(summary.water.remainingMl).toBe(1100);
	});

	it('помечает перебор', () => {
		const summary = calculateNutritionSummary([entry({ calories: 2400 })], nutrition);

		expect(summary.isOverGoal).toBe(true);
		expect(summary.caloriesRemaining).toBe(-300);
	});

	it('остаток воды не уходит в минус', () => {
		const summary = calculateNutritionSummary([], { ...nutrition, waterConsumedMl: 4000 });
		expect(summary.water.remainingMl).toBe(0);
	});
});

describe('calculateWaterProgress', () => {
	it('считает проценты', () => {
		expect(calculateWaterProgress(1250, 2500)).toBe(50);
	});

	it('нулевая цель даёт 0', () => {
		expect(calculateWaterProgress(1250, 0)).toBe(0);
	});
});
