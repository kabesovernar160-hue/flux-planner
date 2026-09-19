import type {
	ConfidenceLevel,
	FoodScanItem,
	FoodScanTotals,
	NutritionPer100g
} from '$lib/types/nutrition';

/**
 * Пересчёт порции и итогов сканирования.
 *
 * Модуль общий для сервера и клиента намеренно. Сервер считает значения при
 * сборке результата, клиент — когда пользователь правит граммы, и обе стороны
 * обязаны получать одинаковые числа. Две независимые реализации округления
 * разъехались бы на первой же дробной порции, и пользователь увидел бы, как
 * сумма меняется сама по себе после сохранения.
 */

/** Калории показываем целыми, макросы — с одним знаком: точнее фото не бывает. */
function roundCalories(value: number): number {
	return Math.round(value);
}

function roundMacro(value: number): number {
	return Math.round(value * 10) / 10;
}

function safeNumber(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Пищевая ценность порции указанного веса. */
export function nutritionForGrams(per100g: NutritionPer100g, grams: number): FoodScanTotals {
	const factor = safeNumber(grams) / 100;

	return {
		calories: roundCalories(safeNumber(per100g.calories) * factor),
		protein: roundMacro(safeNumber(per100g.protein) * factor),
		fat: roundMacro(safeNumber(per100g.fat) * factor),
		carbs: roundMacro(safeNumber(per100g.carbs) * factor)
	};
}

/**
 * Пересчёт компонента под новый вес.
 *
 * Считается от значений на 100 г, а не пропорцией от прежней порции:
 * цепочка «умножили на 1,1, потом ещё на 1,1» копит ошибку округления,
 * и после десятка нажатий на «+» числа перестают сходиться.
 */
export function rescaleItem(item: FoodScanItem, grams: number): FoodScanItem {
	return { ...item, estimatedGrams: grams, ...nutritionForGrams(item.per100g, grams) };
}

export function sumTotals(items: readonly FoodScanItem[]): FoodScanTotals {
	const totals = items.reduce(
		(acc, item) => ({
			calories: acc.calories + safeNumber(item.calories),
			protein: acc.protein + safeNumber(item.protein),
			fat: acc.fat + safeNumber(item.fat),
			carbs: acc.carbs + safeNumber(item.carbs)
		}),
		{ calories: 0, protein: 0, fat: 0, carbs: 0 }
	);

	return {
		calories: roundCalories(totals.calories),
		protein: roundMacro(totals.protein),
		fat: roundMacro(totals.fat),
		carbs: roundMacro(totals.carbs)
	};
}

/**
 * Общая уверенность по набору компонентов.
 *
 * Взвешивается по граммам: неуверенно опознанный соус на 20 г не должен
 * ронять оценку блюда так же сильно, как неуверенно опознанное второе на 300 г.
 */
export function averageConfidence(items: readonly FoodScanItem[]): number {
	const weight = items.reduce((total, item) => total + safeNumber(item.estimatedGrams), 0);
	if (items.length === 0) return 0;

	if (weight === 0) {
		return items.reduce((total, item) => total + safeNumber(item.confidence), 0) / items.length;
	}

	const weighted = items.reduce(
		(total, item) => total + safeNumber(item.confidence) * safeNumber(item.estimatedGrams),
		0
	);

	return weighted / weight;
}

/**
 * Три уровня вместо процентов.
 *
 * Показывать «уверенность 74,3 %» — значит изображать точность, которой нет:
 * это самооценка модели, а не измеренная величина.
 */
export function confidenceLevel(confidence: number): ConfidenceLevel {
	const value = Number.isFinite(confidence) ? confidence : 0;
	if (value >= 0.7) return 'high';
	if (value >= 0.4) return 'medium';
	return 'low';
}

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
	high: 'Оценка выглядит надёжной',
	medium: 'Примерная оценка',
	low: 'Оценка приблизительная'
};

export const CONFIDENCE_HINTS: Record<ConfidenceLevel, string> = {
	high: 'Проверьте вес — по фото его всё равно видно приблизительно.',
	medium: 'Проверьте вес порции: по фотографии он определяется неточно.',
	low: 'Проверьте порцию — по фото её трудно определить.'
};
