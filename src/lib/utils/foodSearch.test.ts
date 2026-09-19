import { describe, expect, it } from 'vitest';
import { findFoodById, normalize, searchFoods, suggestFoods, tokenize } from './foodSearch';

describe('normalize и tokenize', () => {
	it('приводит ё к е и убирает пунктуацию', () => {
		expect(normalize('Гречка, варёная!')).toBe('гречка вареная');
	});

	it('выбрасывает предлоги: они совпадают всегда и только мешают', () => {
		expect(tokenize('овощи на пару')).toEqual(['овощи', 'пару']);
	});
});

describe('searchFoods', () => {
	it('находит по точному названию', () => {
		expect(searchFoods('Куриная грудка')[0].id).toBe('chicken-breast');
	});

	it('находит по другой форме слова', () => {
		expect(searchFoods('Овощами на пару')[0].id).toBe('vegetables');
	});

	it('находит по разговорному синониму', () => {
		expect(searchFoods('Картошка')[0].id).toBe('potato-boiled');
	});

	it('различает похожие продукты по уточнению', () => {
		expect(searchFoods('Сыр')[0].id).toBe('hard-cheese');
		expect(searchFoods('Творожный сыр')[0].id).toBe('cream-cheese');
	});

	it('не выдумывает совпадение для незнакомого блюда', () => {
		expect(searchFoods('Бабушкин пирог по секретному рецепту')).toEqual([]);
	});

	it('на пустом запросе молчит', () => {
		expect(searchFoods('')).toEqual([]);
		expect(searchFoods('  ')).toEqual([]);
	});

	it('отдаёт значения на 100 г, а не на порцию', () => {
		const [rice] = searchFoods('Рис отварной');

		expect(rice.per100g).toEqual({ calories: 130, protein: 2.7, fat: 0.3, carbs: 28 });
	});

	it('ограничивает выдачу', () => {
		expect(searchFoods('сыр', { limit: 2 }).length).toBeLessThanOrEqual(2);
	});
});

describe('suggestFoods', () => {
	it('подсказывает смелее расчёта: человек всё равно выбирает сам', () => {
		// Порог расчёта такой запрос отсеивает, а подсказка — показывает.
		expect(suggestFoods('куриный суп с лапшой').length).toBeGreaterThan(0);
	});

	it('не подсказывает ничего на пустом вводе', () => {
		expect(suggestFoods('')).toEqual([]);
	});
});

describe('findFoodById', () => {
	it('находит запись', () => {
		expect(findFoodById('banana')?.name).toBe('Банан');
	});

	it('для неизвестного идентификатора возвращает null', () => {
		expect(findFoodById('нет-такого')).toBeNull();
	});
});
