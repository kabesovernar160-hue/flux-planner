import { describe, expect, it } from 'vitest';
import { analyzeFoodImage } from './pipeline';
import { createLocalNutritionProvider } from './providers/localNutrition';
import {
	AiError,
	type AnalyzableImage,
	type FoodRecognition,
	type VisionFoodProvider
} from './types';

const image: AnalyzableImage = { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' };

function vision(recognition: FoodRecognition | (() => never)): VisionFoodProvider {
	return {
		name: 'test',
		async analyzeFood() {
			if (typeof recognition === 'function') recognition();
			return recognition as FoodRecognition;
		}
	};
}

const nutrition = createLocalNutritionProvider();

function recognized(overrides: Partial<FoodRecognition['items'][number]> = {}) {
	return {
		name: 'Куриная грудка',
		estimatedGrams: 150,
		confidence: 0.85,
		fallbackPer100g: { calories: 999, protein: 99, fat: 99, carbs: 99 },
		...overrides
	};
}

describe('analyzeFoodImage', () => {
	it('раскладывает блюдо на компоненты и считает каждый по справочнику', async () => {
		const result = await analyzeFoodImage(image, {
			vision: vision({
				isFood: true,
				overallConfidence: 0.8,
				items: [
					recognized(),
					recognized({ name: 'Рис отварной', estimatedGrams: 200 }),
					recognized({ name: 'Овощи', estimatedGrams: 100 }),
					recognized({ name: 'Соус', estimatedGrams: 30 })
				]
			}),
			nutrition
		});

		expect(result.items).toHaveLength(4);

		// Значения из справочника, а не из ответа модели: 165 ккал на 100 г
		// куриной грудки, то есть 248 на порцию в 150 г.
		expect(result.items[0].calories).toBe(248);
		expect(result.items[0].nutritionSource).toBe('database');
		expect(result.items[1].calories).toBe(260);

		expect(result.totals.calories).toBe(result.items.reduce((sum, item) => sum + item.calories, 0));
	});

	it('каждому компоненту выдаёт собственный идентификатор', async () => {
		const result = await analyzeFoodImage(image, {
			vision: vision({
				isFood: true,
				overallConfidence: 0.8,
				items: [recognized(), recognized({ name: 'Рис отварной' })]
			}),
			nutrition
		});

		expect(new Set(result.items.map((item) => item.id)).size).toBe(2);
	});

	it('учитывает способ приготовления при поиске по справочнику', async () => {
		const plain = await analyzeFoodImage(image, {
			vision: vision({
				isFood: true,
				overallConfidence: 0.8,
				items: [recognized({ name: 'Курица', estimatedGrams: 100 })]
			}),
			nutrition
		});

		const fried = await analyzeFoodImage(image, {
			vision: vision({
				isFood: true,
				overallConfidence: 0.8,
				items: [recognized({ name: 'Курица', estimatedGrams: 100, preparation: 'жареная' })]
			}),
			nutrition
		});

		expect(fried.items[0].calories).toBeGreaterThan(plain.items[0].calories);
	});

	it('для продукта вне справочника берёт оценку модели и снижает уверенность', async () => {
		const result = await analyzeFoodImage(image, {
			vision: vision({
				isFood: true,
				overallConfidence: 0.9,
				items: [
					recognized({
						name: 'Бабушкин пирог по секретному рецепту',
						estimatedGrams: 100,
						confidence: 0.9,
						fallbackPer100g: { calories: 300, protein: 5, fat: 12, carbs: 40 }
					})
				]
			}),
			nutrition
		});

		expect(result.items[0].nutritionSource).toBe('estimate');
		expect(result.items[0].calories).toBe(300);
		// Уверенность 0.9 по выдуманной модели цифре была бы враньём в интерфейсе.
		expect(result.items[0].confidence).toBeLessThanOrEqual(0.5);
	});

	it('низкая уверенность доезжает до результата', async () => {
		const result = await analyzeFoodImage(image, {
			vision: vision({
				isFood: true,
				overallConfidence: 0.25,
				items: [recognized({ confidence: 0.2 })]
			}),
			nutrition
		});

		expect(result.overallConfidence).toBeLessThan(0.4);
	});

	it('не завышает общую уверенность относительно ответа модели', async () => {
		const result = await analyzeFoodImage(image, {
			vision: vision({
				isFood: true,
				overallConfidence: 0.3,
				items: [recognized({ confidence: 0.95 })]
			}),
			nutrition
		});

		expect(result.overallConfidence).toBeLessThanOrEqual(0.3);
	});

	it('отказывается выдавать результат, если еды на фото нет', async () => {
		await expect(
			analyzeFoodImage(image, {
				vision: vision({ isFood: false, overallConfidence: 0, items: [] }),
				nutrition
			})
		).rejects.toMatchObject({ code: 'NO_FOOD_DETECTED' });
	});

	it('пустой список компонентов тоже считает отказом', async () => {
		await expect(
			analyzeFoodImage(image, {
				vision: vision({ isFood: true, overallConfidence: 0.9, items: [] }),
				nutrition
			})
		).rejects.toBeInstanceOf(AiError);
	});

	it('пропускает наружу ошибку провайдера', async () => {
		await expect(
			analyzeFoodImage(image, {
				vision: vision(() => {
					throw new AiError('TIMEOUT', 'Слишком долго', 504);
				}),
				nutrition
			})
		).rejects.toMatchObject({ code: 'TIMEOUT' });
	});
});
