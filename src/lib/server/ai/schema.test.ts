import { describe, expect, it } from 'vitest';
import { normalizeFoodRecognition } from './schema';
import { AiError } from './types';

const component = {
	name: 'Куриная грудка',
	estimatedGrams: 150,
	preparation: 'на гриле',
	confidence: 0.85,
	notes: '',
	fallbackPer100g: { calories: 165, protein: 31, fat: 3.6, carbs: 0 }
};

const valid = {
	isFood: true,
	overallConfidence: 0.8,
	items: [component]
};

describe('normalizeFoodRecognition', () => {
	it('пропускает корректный ответ', () => {
		const result = normalizeFoodRecognition(valid);

		expect(result.isFood).toBe(true);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].name).toBe('Куриная грудка');
		expect(result.items[0].estimatedGrams).toBe(150);
		expect(result.items[0].preparation).toBe('на гриле');
	});

	it('разбирает несколько компонентов одного блюда', () => {
		const result = normalizeFoodRecognition({
			...valid,
			items: [
				component,
				{ ...component, name: 'Рис отварной', estimatedGrams: 200 },
				{ ...component, name: 'Овощи', estimatedGrams: 100 },
				{ ...component, name: 'Соус', estimatedGrams: 30 }
			]
		});

		expect(result.items.map((item) => item.name)).toEqual([
			'Куриная грудка',
			'Рис отварной',
			'Овощи',
			'Соус'
		]);
	});

	it('отвергает ответ с пропущенными полями', () => {
		expect(() => normalizeFoodRecognition({ isFood: true, items: [{ name: 'Еда' }] })).toThrow(
			AiError
		);
	});

	it('отвергает не-объект', () => {
		expect(() => normalizeFoodRecognition(null)).toThrow(AiError);
		expect(() => normalizeFoodRecognition('не json')).toThrow(AiError);
		expect(() => normalizeFoodRecognition([])).toThrow(AiError);
	});

	it('отвергает строки вместо чисел', () => {
		expect(() =>
			normalizeFoodRecognition({ ...valid, items: [{ ...component, estimatedGrams: '150' }] })
		).toThrow(AiError);
	});

	it('пустой ответ модели превращает в «еды нет», а не в выдуманный результат', () => {
		const result = normalizeFoodRecognition({ isFood: true, items: [], overallConfidence: 0.9 });

		expect(result.isFood).toBe(false);
		expect(result.items).toEqual([]);
		expect(result.overallConfidence).toBe(0);
	});

	it('при isFood: false игнорирует присланные компоненты', () => {
		const result = normalizeFoodRecognition({ ...valid, isFood: false });

		expect(result.items).toEqual([]);
	});

	it('отвергает ответ с NaN вместо числа', () => {
		// Это не оговорка модели, а сломанный ответ: чинить его догадками
		// опаснее, чем честно отказаться.
		expect(() =>
			normalizeFoodRecognition({
				...valid,
				items: [
					component,
					{
						...component,
						name: 'Рис',
						fallbackPer100g: { ...component.fallbackPer100g, calories: Number.NaN }
					}
				]
			})
		).toThrow(AiError);
	});

	it('выбрасывает компонент без названия и без веса', () => {
		const result = normalizeFoodRecognition({
			...valid,
			items: [component, { ...component, name: '   ' }, { ...component, estimatedGrams: 0 }]
		});

		expect(result.items).toHaveLength(1);
	});

	it('обрезает абсурдные значения вместо отказа', () => {
		const result = normalizeFoodRecognition({
			...valid,
			items: [
				{
					...component,
					estimatedGrams: 999_999,
					fallbackPer100g: { calories: 99_999, protein: -5, fat: 3, carbs: 2 }
				}
			]
		});

		expect(result.items[0].estimatedGrams).toBe(20_000);
		expect(result.items[0].fallbackPer100g?.calories).toBe(1_000);
		expect(result.items[0].fallbackPer100g?.protein).toBe(0);
	});

	it('зажимает уверенность в диапазон 0…1', () => {
		const high = normalizeFoodRecognition({
			...valid,
			overallConfidence: 5,
			items: [{ ...component, confidence: 5 }]
		});
		const low = normalizeFoodRecognition({
			...valid,
			overallConfidence: -1,
			items: [{ ...component, confidence: -1 }]
		});

		expect(high.overallConfidence).toBe(1);
		expect(high.items[0].confidence).toBe(1);
		expect(low.overallConfidence).toBe(0);
		expect(low.items[0].confidence).toBe(0);
	});

	it('не принимает список длиннее разумного', () => {
		const many = Array.from({ length: 30 }, (_, index) => ({
			...component,
			name: `Продукт ${index}`
		}));

		const result = normalizeFoodRecognition({ ...valid, items: many });

		expect(result.items.length).toBeLessThanOrEqual(12);
	});

	it('убирает пустые строки в необязательных полях', () => {
		const result = normalizeFoodRecognition({
			...valid,
			items: [{ ...component, preparation: '  ', notes: '' }]
		});

		expect(result.items[0].preparation).toBeUndefined();
		expect(result.items[0].notes).toBeUndefined();
	});
});
