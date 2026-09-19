import { z } from 'zod';
import { AiError, type FoodRecognition } from './types';

/**
 * Схема ответа модели.
 *
 * Используется дважды: как описание формата в запросе к модели и как проверка
 * того, что пришло. Structured outputs заставляют модель отвечать по форме,
 * но ответ всё равно перепроверяется — гарантия провайдера это не то же самое,
 * что проверка на нашей стороне, а данные отсюда уходят в дневник питания.
 */
const per100gSchema = z.object({
	calories: z.number().describe('Калорийность 100 г продукта, ккал'),
	protein: z.number().describe('Белки в 100 г, г'),
	fat: z.number().describe('Жиры в 100 г, г'),
	carbs: z.number().describe('Углеводы в 100 г, г')
});

const recognizedFoodSchema = z.object({
	name: z.string().describe('Название компонента на русском языке, коротко'),
	estimatedGrams: z.number().describe('Оценка веса этого компонента на фото, г'),
	preparation: z
		.string()
		.describe('Способ приготовления, если он виден. Пустая строка, если не определяется'),
	confidence: z.number().describe('Уверенность в этом компоненте, от 0 до 1'),
	notes: z.string().describe('Короткое уточнение или пустая строка'),
	fallbackPer100g: per100gSchema.describe('Ориентировочная ценность 100 г самого продукта')
});

export const foodRecognitionSchema = z.object({
	isFood: z.boolean().describe('Есть ли на фотографии еда или напиток'),
	items: z.array(recognizedFoodSchema).describe('Компоненты блюда. Пустой список, если еды нет'),
	overallConfidence: z.number().describe('Общая уверенность по снимку, от 0 до 1')
});

const MAX_GRAMS = 20_000;
const MAX_CALORIES_PER_100G = 1_000;
const MAX_MACRO_PER_100G = 100;
const MAX_NAME_LENGTH = 80;
const MAX_NOTES_LENGTH = 120;

/**
 * Больше — почти наверняка галлюцинация: тарелка не бывает из сорока
 * компонентов, а список такой длины невозможно ни проверить, ни поправить.
 */
const MAX_ITEMS = 12;

function clamp(value: number, max: number): number | null {
	// Бесконечность и NaN — сломанный ответ, их нельзя молча превращать в ноль.
	if (!Number.isFinite(value)) return null;
	return Math.min(max, Math.max(0, value));
}

function clampConfidence(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function trimOrUndefined(value: string | undefined, max: number): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Приведение сырого ответа к безопасному виду.
 *
 * На вход принимает что угодно: ответ модели — недоверенные данные.
 *
 * Нарушение типов (строка вместо числа, NaN, отсутствующее поле) отвергает
 * весь ответ: это сломанный ответ, а не оговорка. А вот компонент, у которого
 * после разбора не осталось названия или веса, просто выбрасывается —
 * из-за одной пустой строки незачем терять остальные распознанные продукты.
 * Если после отсева не осталось ничего, это равносильно «еды не видно».
 */
export function normalizeFoodRecognition(raw: unknown): FoodRecognition {
	const parsed = foodRecognitionSchema.safeParse(raw);

	if (!parsed.success) {
		throw new AiError(
			'INVALID_AI_RESPONSE',
			'Модель вернула некорректный ответ',
			502,
			parsed.error
		);
	}

	const data = parsed.data;

	if (!data.isFood) {
		return { isFood: false, items: [], overallConfidence: 0 };
	}

	const items = data.items.slice(0, MAX_ITEMS).flatMap((item) => {
		const grams = clamp(item.estimatedGrams, MAX_GRAMS);
		const calories = clamp(item.fallbackPer100g.calories, MAX_CALORIES_PER_100G);
		const protein = clamp(item.fallbackPer100g.protein, MAX_MACRO_PER_100G);
		const fat = clamp(item.fallbackPer100g.fat, MAX_MACRO_PER_100G);
		const carbs = clamp(item.fallbackPer100g.carbs, MAX_MACRO_PER_100G);

		const name = item.name.trim();

		// Компонент без названия или без веса нечего показывать пользователю:
		// подтвердить «— 0 г» невозможно.
		if (!name || grams === null || grams <= 0) return [];
		if (calories === null || protein === null || fat === null || carbs === null) return [];

		return [
			{
				name: name.slice(0, MAX_NAME_LENGTH),
				estimatedGrams: grams,
				preparation: trimOrUndefined(item.preparation, MAX_NOTES_LENGTH),
				confidence: clampConfidence(item.confidence),
				notes: trimOrUndefined(item.notes, MAX_NOTES_LENGTH),
				fallbackPer100g: { calories, protein, fat, carbs }
			}
		];
	});

	if (items.length === 0) {
		return { isFood: false, items: [], overallConfidence: 0 };
	}

	return {
		isFood: true,
		items,
		overallConfidence: clampConfidence(data.overallConfidence)
	};
}
