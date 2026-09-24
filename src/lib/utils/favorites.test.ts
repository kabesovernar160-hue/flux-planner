import { describe, expect, it } from 'vitest';
import {
	activeFavorites,
	isFavorite,
	MAX_FAVORITES,
	mergeFavorites,
	readFavorites,
	toggleFavorite
} from './favorites';

const oatmeal = { name: 'Овсянка', grams: 60, calories: 230, protein: 8, fat: 4, carbs: 40 };
const soup = { name: 'Борщ', calories: 180, protein: 6, fat: 7, carbs: 20 };

describe('избранное', () => {
	it('звёздочка ставится и снимается, снятие остаётся отметкой', () => {
		const added = toggleFavorite([], oatmeal, '2026-01-10T08:00:00.000Z');
		expect(isFavorite(added, ' овсянка')).toBe(true);

		const removed = toggleFavorite(added, oatmeal, '2026-01-11T08:00:00.000Z');
		expect(isFavorite(removed, 'Овсянка')).toBe(false);
		expect(removed[0].removedAt).toBe('2026-01-11T08:00:00.000Z');
	});

	it('звёздочки с двух устройств не затирают друг друга', () => {
		const phone = toggleFavorite([], oatmeal, '2026-01-10T08:00:00.000Z');
		const tablet = toggleFavorite([], soup, '2026-01-10T09:00:00.000Z');

		const merged = mergeFavorites(phone, tablet);

		expect(activeFavorites(merged).map((item) => item.name)).toEqual(['Борщ', 'Овсянка']);
		// Порядок встречи версий не важен.
		expect(activeFavorites(mergeFavorites(tablet, phone))).toEqual(activeFavorites(merged));
	});

	it('снятие на одном устройстве доезжает до другого', () => {
		const both = toggleFavorite([], oatmeal, '2026-01-10T08:00:00.000Z');
		const phone = toggleFavorite(both, oatmeal, '2026-01-12T08:00:00.000Z');

		expect(isFavorite(mergeFavorites(both, phone), 'Овсянка')).toBe(false);
	});

	it('старая версия приложения без списка ничего не стирает', () => {
		const current = toggleFavorite([], oatmeal, '2026-01-10T08:00:00.000Z');

		expect(activeFavorites(mergeFavorites(current, undefined))).toHaveLength(1);
		expect(activeFavorites(mergeFavorites(undefined, current))).toHaveLength(1);
	});

	it('испорченные элементы отбрасываются, а не роняют список', () => {
		const list = readFavorites([
			{ name: 'Овсянка', calories: 230, protein: 8, fat: 4, carbs: 40, updatedAt: '2026-01-10' },
			{ name: '', calories: 1, protein: 1, fat: 1, carbs: 1, updatedAt: 'x' },
			{ name: 'Суп', calories: 'много', protein: 1, fat: 1, carbs: 1, updatedAt: 'x' },
			'мусор',
			null
		]);

		expect(list.map((item) => item.name)).toEqual(['Овсянка']);
		expect(readFavorites('не список')).toEqual([]);
	});

	it('список не растёт бесконечно, свежие звёздочки сохраняются', () => {
		let list: unknown = [];
		for (let index = 0; index < MAX_FAVORITES + 10; index++) {
			const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
			list = toggleFavorite(list, { ...soup, name: `Блюдо ${index}` }, stamp);
		}

		const items = readFavorites(list);
		expect(items).toHaveLength(MAX_FAVORITES);
		expect(isFavorite(items, `Блюдо ${MAX_FAVORITES + 9}`)).toBe(true);
	});
});
