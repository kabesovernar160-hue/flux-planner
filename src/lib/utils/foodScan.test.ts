import { describe, expect, it } from 'vitest';
import type { FoodScanItem } from '$lib/types/nutrition';
import {
	averageConfidence,
	confidenceLevel,
	nutritionForGrams,
	rescaleItem,
	sumTotals
} from './foodScan';

function item(overrides: Partial<FoodScanItem> = {}): FoodScanItem {
	return {
		id: 'a',
		name: 'Рис отварной',
		estimatedGrams: 200,
		calories: 260,
		protein: 5.4,
		fat: 0.6,
		carbs: 56,
		per100g: { calories: 130, protein: 2.7, fat: 0.3, carbs: 28 },
		nutritionSource: 'database',
		confidence: 0.8,
		...overrides
	};
}

describe('nutritionForGrams', () => {
	it('считает порцию от значений на 100 граммов', () => {
		const result = nutritionForGrams({ calories: 165, protein: 31, fat: 3.6, carbs: 0 }, 150);

		expect(result).toEqual({ calories: 248, protein: 46.5, fat: 5.4, carbs: 0 });
	});

	it('возвращает нули для нулевой порции', () => {
		expect(nutritionForGrams({ calories: 130, protein: 2.7, fat: 0.3, carbs: 28 }, 0)).toEqual({
			calories: 0,
			protein: 0,
			fat: 0,
			carbs: 0
		});
	});

	it('не даёт отрицательных значений при мусоре на входе', () => {
		const result = nutritionForGrams(
			{ calories: -100, protein: Number.NaN, fat: 5, carbs: 10 },
			100
		);

		expect(result.calories).toBe(0);
		expect(result.protein).toBe(0);
		expect(result.fat).toBe(5);
	});
});

describe('rescaleItem', () => {
	it('пересчитывает макросы под новый вес', () => {
		const next = rescaleItem(item(), 100);

		expect(next.estimatedGrams).toBe(100);
		expect(next.calories).toBe(130);
		expect(next.protein).toBe(2.7);
		expect(next.carbs).toBe(28);
	});

	it('считает от значений на 100 г, а не от прежней порции', () => {
		// Десять нажатий «+10» и одно возвращение к исходному весу должны дать
		// ровно исходные числа: накопленная ошибка округления здесь недопустима.
		let current = item();
		for (let i = 0; i < 10; i += 1) current = rescaleItem(current, current.estimatedGrams + 10);
		current = rescaleItem(current, 200);

		expect(current).toEqual(item());
	});

	it('сохраняет название и источник данных', () => {
		const next = rescaleItem(item({ name: 'Рис', nutritionSource: 'estimate' }), 350);

		expect(next.name).toBe('Рис');
		expect(next.nutritionSource).toBe('estimate');
	});
});

describe('sumTotals', () => {
	it('складывает несколько компонентов', () => {
		const totals = sumTotals([
			item({ id: '1', calories: 248, protein: 46.5, fat: 5.4, carbs: 0 }),
			item({ id: '2', calories: 260, protein: 5.4, fat: 0.6, carbs: 56 }),
			item({ id: '3', calories: 45, protein: 2, fat: 1.5, carbs: 7 })
		]);

		expect(totals).toEqual({ calories: 553, protein: 53.9, fat: 7.5, carbs: 63 });
	});

	it('на пустом списке даёт нули', () => {
		expect(sumTotals([])).toEqual({ calories: 0, protein: 0, fat: 0, carbs: 0 });
	});

	it('пропускает битое значение вместо того, чтобы обнулить итог', () => {
		const totals = sumTotals([
			item({ id: '1', calories: 200 }),
			item({ id: '2', calories: Number.NaN })
		]);

		expect(totals.calories).toBe(200);
	});
});

describe('averageConfidence', () => {
	it('взвешивает уверенность по граммам', () => {
		// Неуверенный соус на 20 г не должен весить столько же,
		// сколько уверенно опознанное второе на 300 г.
		const value = averageConfidence([
			item({ id: '1', estimatedGrams: 300, confidence: 0.9 }),
			item({ id: '2', estimatedGrams: 20, confidence: 0.2 })
		]);

		expect(value).toBeGreaterThan(0.8);
	});

	it('на пустом списке возвращает ноль', () => {
		expect(averageConfidence([])).toBe(0);
	});
});

describe('confidenceLevel', () => {
	it('раскладывает по трём уровням', () => {
		expect(confidenceLevel(0.9)).toBe('high');
		expect(confidenceLevel(0.55)).toBe('medium');
		expect(confidenceLevel(0.2)).toBe('low');
	});

	it('считает мусор низкой уверенностью', () => {
		expect(confidenceLevel(Number.NaN)).toBe('low');
	});
});
