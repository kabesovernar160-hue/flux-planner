import { describe, expect, it } from 'vitest';
import type { FoodEntry } from '$lib/types/nutrition';
import { frequentFoods } from './foodHistory';

const entry = (overrides: Partial<FoodEntry> & { date: string; name: string }): FoodEntry => ({
	id: `${overrides.date}-${overrides.name}`,
	calories: 300,
	protein: 10,
	fat: 5,
	carbs: 40,
	source: 'manual',
	createdAt: `${overrides.date}T08:00:00.000Z`,
	updatedAt: `${overrides.date}T08:00:00.000Z`,
	...overrides
});

describe('frequentFoods', () => {
	it('чаще съеденное идёт выше', () => {
		const result = frequentFoods(
			[
				entry({ date: '2026-01-13', name: 'Овсянка' }),
				entry({ date: '2026-01-14', name: 'Овсянка' }),
				entry({ date: '2026-01-14', name: 'Борщ' })
			],
			{ end: '2026-01-15' }
		);

		expect(result.map((food) => food.name)).toEqual(['Овсянка', 'Борщ']);
		expect(result[0].count).toBe(2);
	});

	it('название и вес берутся из последней записи', () => {
		// Порция могла поменяться, и подставлять прошлогоднюю значит
		// заставлять править её руками каждый раз.
		const result = frequentFoods(
			[
				entry({ date: '2026-01-10', name: 'Овсянка', grams: 60, calories: 230 }),
				entry({ date: '2026-01-14', name: 'Овсянка с ягодами', grams: 90, calories: 340 })
			],
			{ end: '2026-01-15' }
		);

		expect(result[0].name).toBe('Овсянка с ягодами');
		expect(result[0].grams).toBe(90);
		expect(result[0].calories).toBe(340);
	});

	it('разный регистр и пробелы считаются одним блюдом', () => {
		const result = frequentFoods(
			[
				entry({ date: '2026-01-13', name: 'Кофе' }),
				entry({ date: '2026-01-14', name: '  кофе  ' })
			],
			{ end: '2026-01-15' }
		);

		expect(result).toHaveLength(1);
		expect(result[0].count).toBe(2);
	});

	it('за пределы периода не выходит', () => {
		const result = frequentFoods(
			[
				entry({ date: '2025-11-01', name: 'Старое' }),
				entry({ date: '2026-01-14', name: 'Свежее' })
			],
			{ end: '2026-01-15', days: 30 }
		);

		expect(result.map((food) => food.name)).toEqual(['Свежее']);
	});

	it('фильтрует по приёму пищи', () => {
		// Утром предлагать вчерашний ужин бессмысленно.
		const result = frequentFoods(
			[
				entry({ date: '2026-01-14', name: 'Овсянка', meal: 'breakfast' }),
				entry({ date: '2026-01-14', name: 'Стейк', meal: 'dinner' })
			],
			{ end: '2026-01-15', meal: 'breakfast', timeZone: 'UTC' }
		);

		expect(result.map((food) => food.name)).toEqual(['Овсянка']);
	});

	it('соблюдает предел списка', () => {
		const entries = Array.from({ length: 10 }, (_, index) =>
			entry({ date: '2026-01-14', name: `Блюдо ${index}` })
		);

		expect(frequentFoods(entries, { end: '2026-01-15', limit: 3 })).toHaveLength(3);
	});

	it('на пустой истории отдаёт пустой список', () => {
		expect(frequentFoods([], { end: '2026-01-15' })).toEqual([]);
	});
});
