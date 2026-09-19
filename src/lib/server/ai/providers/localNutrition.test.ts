import { describe, expect, it } from 'vitest';
import { createLocalNutritionProvider } from './localNutrition';

const provider = createLocalNutritionProvider();

describe('searchFood', () => {
	it('находит по точному названию', async () => {
		const [match] = await provider.searchFood('Куриная грудка');

		expect(match.id).toBe('chicken-breast');
		expect(match.per100g.calories).toBe(165);
	});

	it('находит по слову в другом падеже', async () => {
		// Модель возвращает названия в произвольной форме: «овощи», «овощами».
		const [match] = await provider.searchFood('Овощами на пару');

		expect(match.id).toBe('vegetables');
	});

	it('находит по синониму', async () => {
		const [match] = await provider.searchFood('Картошка');

		expect(match.id).toBe('potato-boiled');
	});

	it('различает похожие продукты по уточнению', async () => {
		const [cheese] = await provider.searchFood('Сыр');
		const [curd] = await provider.searchFood('Творожный сыр');

		expect(cheese.id).toBe('hard-cheese');
		expect(curd.id).toBe('cream-cheese');
	});

	it('сортирует по совпадению', async () => {
		const matches = await provider.searchFood('Рис отварной');

		expect(matches[0].id).toBe('rice');
		expect(matches[0].matchScore ?? 0).toBeGreaterThanOrEqual(matches[1]?.matchScore ?? 0);
	});

	it('ничего не выдумывает для незнакомого продукта', async () => {
		expect(await provider.searchFood('Бабушкин пирог по секретному рецепту')).toEqual([]);
		expect(await provider.searchFood('Неизвестный продукт')).toEqual([]);
	});

	it('на пустом запросе возвращает пустой список', async () => {
		expect(await provider.searchFood('')).toEqual([]);
		expect(await provider.searchFood('  ')).toEqual([]);
	});
});

describe('getNutrition', () => {
	it('отдаёт запись по идентификатору', async () => {
		const record = await provider.getNutrition('rice');

		expect(record?.name).toBe('Рис отварной');
		expect(record?.per100g).toEqual({ calories: 130, protein: 2.7, fat: 0.3, carbs: 28 });
	});

	it('возвращает null для неизвестного идентификатора', async () => {
		expect(await provider.getNutrition('нет-такого')).toBeNull();
	});
});
