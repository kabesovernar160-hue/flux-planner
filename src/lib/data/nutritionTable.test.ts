import { describe, expect, it } from 'vitest';
import { NUTRITION_TABLE } from './nutritionTable';

/**
 * Проверки самой таблицы, а не поиска по ней.
 *
 * Справочник пополняется руками, и ошибка в нём тихо расходится по всему
 * приложению: по этим числам считает и распознавание, и ручной ввод.
 * Опечатка в граммах белка не упадёт — она просто соврёт.
 */

describe('справочник продуктов', () => {
	it('не пустой', () => {
		expect(NUTRITION_TABLE.length).toBeGreaterThan(150);
	});

	it('идентификаторы уникальны', () => {
		const ids = NUTRITION_TABLE.map((food) => food.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('названия не повторяются', () => {
		const names = NUTRITION_TABLE.map((food) => food.name.toLowerCase());
		expect(new Set(names).size).toBe(names.length);
	});

	it('синоним принадлежит одному продукту', () => {
		// Один синоним у двух продуктов означает, что поиск выдаёт случайный
		// из них, и человек получает чужие калории.
		const owners = new Map<string, string>();
		const clashes: string[] = [];

		for (const food of NUTRITION_TABLE) {
			for (const synonym of food.synonyms) {
				const key = synonym.toLowerCase();
				const owner = owners.get(key);
				if (owner) clashes.push(`${key}: ${owner} и ${food.id}`);
				owners.set(key, food.id);
			}
		}

		expect(clashes).toEqual([]);
	});

	it('синоним не совпадает с чужим названием', () => {
		const names = new Map(NUTRITION_TABLE.map((food) => [food.name.toLowerCase(), food.id]));
		const clashes: string[] = [];

		for (const food of NUTRITION_TABLE) {
			for (const synonym of food.synonyms) {
				const owner = names.get(synonym.toLowerCase());
				if (owner && owner !== food.id) clashes.push(`${synonym}: ${owner} и ${food.id}`);
			}
		}

		expect(clashes).toEqual([]);
	});

	it('значения неотрицательны и правдоподобны', () => {
		for (const food of NUTRITION_TABLE) {
			const { calories, protein, fat, carbs } = food.per100g;

			for (const value of [calories, protein, fat, carbs]) {
				expect(Number.isFinite(value)).toBe(true);
				expect(value).toBeGreaterThanOrEqual(0);
			}

			// В ста граммах не бывает больше ста граммов содержимого
			// и больше 900 ккал (чистый жир — 884).
			expect(protein + fat + carbs).toBeLessThanOrEqual(100);
			expect(calories).toBeLessThanOrEqual(900);
		}
	});

	it('калории сходятся с макросами', () => {
		// Белок и углеводы по 4 ккал на грамм, жир — 9. Расхождение больше
		// трети означает опечатку: такие числа в дневнике не заметит никто.
		const alcoholic = new Set(['beer', 'wine']);
		const mismatched: string[] = [];

		for (const food of NUTRITION_TABLE) {
			if (alcoholic.has(food.id)) continue;

			const { calories, protein, fat, carbs } = food.per100g;
			if (calories <= 5) continue;

			const expected = protein * 4 + fat * 9 + carbs * 4;
			if (Math.abs(expected - calories) > Math.max(35, calories * 0.35)) {
				mismatched.push(`${food.name}: ${calories} против ${Math.round(expected)}`);
			}
		}

		expect(mismatched).toEqual([]);
	});
});
