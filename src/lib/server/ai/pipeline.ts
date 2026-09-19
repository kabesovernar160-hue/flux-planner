import type { FoodScanItem, FoodScanResult } from '$lib/types/nutrition';
import { averageConfidence, nutritionForGrams, sumTotals } from '$lib/utils/foodScan';
import { createId } from '$lib/utils/id';
import {
	AiError,
	type AnalyzableImage,
	type NutritionProvider,
	type RecognizedFood,
	type VisionFoodProvider
} from './types';

/**
 * Сборка результата сканирования.
 *
 * Здесь сходятся две принципиально разные вещи, и разделение между ними —
 * главная идея всего сканера:
 *
 *   РАСПОЗНАВАНИЕ  — что видно на фото и сколько этого примерно (vision-модель);
 *   РАСЧЁТ ЦЕННОСТИ — сколько в этом калорий и макросов (справочник питания).
 *
 * Vision-модель по фотографии не знает ни точного веса, ни количества масла,
 * ни сахара в соусе. Спрашивать у неё «сколько здесь калорий» — значит получать
 * правдоподобное число без опоры на что-либо. Поэтому калорийность берётся
 * из справочника по названию продукта и умножается на вес, а ответ модели
 * участвует в расчёте только как оценка веса.
 */

/**
 * Потолок уверенности для компонента, которого нет в справочнике.
 *
 * Такие значения целиком держатся на предположении модели, и показывать по ним
 * высокую уверенность было бы враньём в интерфейсе.
 */
const ESTIMATE_CONFIDENCE_CAP = 0.5;

export interface PipelineDeps {
	vision: VisionFoodProvider;
	nutrition: NutritionProvider;
}

/**
 * Подбор записи справочника под распознанный компонент.
 *
 * Сначала пробуем название вместе со способом приготовления: «курица» и
 * «курица жареная» — это 165 и 230 ккал на сто граммов, и разница в порции
 * получается ощутимой. Если такого варианта в справочнике нет, ищем по одному
 * названию.
 */
async function lookupNutrition(nutrition: NutritionProvider, item: RecognizedFood) {
	const queries = item.preparation ? [`${item.name} ${item.preparation}`, item.name] : [item.name];

	let best: Awaited<ReturnType<NutritionProvider['searchFood']>>[number] | null = null;

	for (const query of queries) {
		const [match] = await nutrition.searchFood(query);
		if (match && (!best || (match.matchScore ?? 0) > (best.matchScore ?? 0))) best = match;
	}

	return best;
}

function buildItem(
	recognized: RecognizedFood,
	match: Awaited<ReturnType<NutritionProvider['searchFood']>>[number] | null
): FoodScanItem {
	const per100g = match ? match.per100g : recognized.fallbackPer100g;

	// Схема гарантирует fallbackPer100g, но провайдер может быть и не наш:
	// компонент без основы для расчёта показывать нечем.
	if (!per100g) {
		return {
			id: createId(),
			name: recognized.name,
			estimatedGrams: recognized.estimatedGrams,
			calories: 0,
			protein: 0,
			fat: 0,
			carbs: 0,
			per100g: { calories: 0, protein: 0, fat: 0, carbs: 0 },
			nutritionSource: 'estimate',
			confidence: 0,
			notes: recognized.notes
		};
	}

	const confidence = match
		? recognized.confidence
		: Math.min(recognized.confidence, ESTIMATE_CONFIDENCE_CAP);

	const notes = [recognized.preparation, recognized.notes].filter(Boolean).join(', ') || undefined;

	return {
		id: createId(),
		// Название из справочника точнее для дневника («Куриная грудка» вместо
		// «куриное филе на гриле»), но если продукт не нашёлся — остаётся
		// формулировка модели.
		name: match ? match.name : recognized.name,
		estimatedGrams: recognized.estimatedGrams,
		...nutritionForGrams(per100g, recognized.estimatedGrams),
		per100g,
		nutritionSource: match ? 'database' : 'estimate',
		confidence,
		notes
	};
}

export async function analyzeFoodImage(
	image: AnalyzableImage,
	deps: PipelineDeps
): Promise<FoodScanResult> {
	const recognition = await deps.vision.analyzeFood(image);

	// Плохое фото, не еда, пустой ответ модели — для пользователя это один
	// и тот же исход: показывать нечего. Выдумывать результат в таком случае
	// хуже, чем честно сказать «не получилось».
	if (!recognition.isFood || recognition.items.length === 0) {
		throw new AiError('NO_FOOD_DETECTED', 'Не удалось уверенно определить еду', 422);
	}

	const items: FoodScanItem[] = [];

	for (const recognized of recognition.items) {
		items.push(buildItem(recognized, await lookupNutrition(deps.nutrition, recognized)));
	}

	// Из двух оценок уверенности берём меньшую: модель склонна оценивать себя
	// оптимистичнее, чем получается после сверки со справочником.
	const overallConfidence = Math.min(recognition.overallConfidence, averageConfidence(items));

	return {
		items,
		totals: sumTotals(items),
		overallConfidence: Math.min(1, Math.max(0, overallConfidence))
	};
}
