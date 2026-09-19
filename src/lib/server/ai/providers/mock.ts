import type { AnalyzableImage, FoodRecognition, VisionFoodProvider } from '../types';

/**
 * DEVELOPMENT ONLY.
 *
 * Детерминированная подмена распознавания: одно и то же изображение всегда даёт
 * один и тот же результат. Случайный ответ делал бы невозможной отладку
 * интерфейса — экран подтверждения менялся бы при каждом прогоне.
 *
 * Наборы подобраны так, чтобы интерфейс подтверждения приходилось проверять
 * на разном: несколько компонентов, единственный компонент, продукт вне
 * справочника, низкая уверенность.
 */
const PLATES: FoodRecognition[] = [
	{
		isFood: true,
		overallConfidence: 0.78,
		items: [
			{
				name: 'Куриная грудка',
				estimatedGrams: 150,
				preparation: 'на гриле',
				confidence: 0.86,
				fallbackPer100g: { calories: 165, protein: 31, fat: 3.6, carbs: 0 }
			},
			{
				name: 'Рис отварной',
				estimatedGrams: 200,
				confidence: 0.82,
				fallbackPer100g: { calories: 130, protein: 2.7, fat: 0.3, carbs: 28 }
			},
			{
				name: 'Овощи на гриле',
				estimatedGrams: 100,
				confidence: 0.6,
				fallbackPer100g: { calories: 45, protein: 2, fat: 1.5, carbs: 7 }
			},
			{
				name: 'Соус',
				estimatedGrams: 30,
				confidence: 0.35,
				notes: 'состав по фото не определить',
				fallbackPer100g: { calories: 150, protein: 2, fat: 12, carbs: 8 }
			}
		]
	},
	{
		isFood: true,
		overallConfidence: 0.84,
		items: [
			{
				name: 'Овсяная каша',
				estimatedGrams: 250,
				confidence: 0.88,
				fallbackPer100g: { calories: 88, protein: 3, fat: 1.7, carbs: 15 }
			},
			{
				name: 'Ягоды',
				estimatedGrams: 60,
				confidence: 0.8,
				fallbackPer100g: { calories: 45, protein: 0.8, fat: 0.4, carbs: 10 }
			},
			{
				name: 'Мёд',
				estimatedGrams: 15,
				confidence: 0.45,
				fallbackPer100g: { calories: 320, protein: 0.3, fat: 0, carbs: 82 }
			}
		]
	},
	{
		isFood: true,
		overallConfidence: 0.3,
		items: [
			{
				name: 'Неизвестный продукт',
				estimatedGrams: 180,
				confidence: 0.22,
				notes: 'блюдо не опознано',
				fallbackPer100g: { calories: 210, protein: 8, fat: 11, carbs: 20 }
			}
		]
	},
	{
		isFood: true,
		overallConfidence: 0.72,
		items: [
			{
				name: 'Паста карбонара',
				estimatedGrams: 320,
				confidence: 0.75,
				fallbackPer100g: { calories: 370, protein: 13, fat: 20, carbs: 33 }
			},
			{
				name: 'Сыр',
				estimatedGrams: 20,
				preparation: 'тёртый',
				confidence: 0.55,
				fallbackPer100g: { calories: 364, protein: 25, fat: 30, carbs: 2 }
			}
		]
	},
	{
		// Еды на снимке нет: интерфейс обязан уметь показывать и этот исход.
		isFood: false,
		overallConfidence: 0,
		items: []
	}
];

/**
 * Хеш по выборке байтов, а не по всему файлу: пятимегабайтное изображение
 * незачем прогонять целиком ради выбора одного из нескольких вариантов.
 */
function sampleHash(bytes: Uint8Array): number {
	const step = Math.max(1, Math.floor(bytes.length / 512));
	let hash = bytes.length;

	for (let i = 0; i < bytes.length; i += step) {
		hash = (hash * 31 + bytes[i]) | 0;
	}

	return Math.abs(hash);
}

export function createMockVisionProvider(): VisionFoodProvider {
	return {
		name: 'mock',

		async analyzeFood(image: AnalyzableImage): Promise<FoodRecognition> {
			return PLATES[sampleHash(image.bytes) % PLATES.length];
		}
	};
}
