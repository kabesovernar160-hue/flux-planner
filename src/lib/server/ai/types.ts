import type { FoodScanItem, FoodScanResult, NutritionPer100g } from '$lib/types/nutrition';

export type { FoodScanItem, FoodScanResult, NutritionPer100g };

export interface AnalyzableImage {
	bytes: Uint8Array;
	mediaType: string;
}

/**
 * Один компонент в ответе vision-модели.
 *
 * Здесь НЕТ калорий и макросов, и это главное архитектурное решение сканера.
 * Модель по фотографии видит, что лежит на тарелке, и грубо оценивает вес,
 * но не знает, сколько масла ушло на жарку и сколько сахара в соусе.
 * Пищевую ценность считает отдельный движок — см. NutritionProvider.
 */
export interface RecognizedFood {
	name: string;
	estimatedGrams: number;
	/** Способ приготовления, если он виден на фото: «жареное», «на пару». */
	preparation?: string;
	confidence: number;
	notes?: string;
	/**
	 * Запасная оценка на 100 г от самой модели.
	 *
	 * Используется, только если продукта нет в справочнике: без неё
	 * незнакомое блюдо пришлось бы выбрасывать из результата целиком.
	 * Такой компонент помечается nutritionSource: 'estimate'.
	 */
	fallbackPer100g?: NutritionPer100g;
}

/**
 * Полный ответ распознавания.
 *
 * isFood отделяет «на фото нет еды» от «еда есть, но я не уверен»:
 * в первом случае показывать нечего, во втором — есть что подтверждать.
 */
export interface FoodRecognition {
	isFood: boolean;
	items: RecognizedFood[];
	overallConfidence: number;
}

/**
 * Провайдер распознавания.
 *
 * Абстракция нужна не ради красоты: она позволяет подменить модель без правок
 * в эндпоинте и держит в тестах детерминированную реализацию вместо сетевого
 * вызова, который стоит денег и отвечает по-разному.
 */
export interface VisionFoodProvider {
	readonly name: string;
	analyzeFood(image: AnalyzableImage): Promise<FoodRecognition>;
}

/** Запись справочника питания. */
export interface FoodNutrition {
	id: string;
	name: string;
	per100g: NutritionPer100g;
	/** Насколько уверенно запрос сопоставился с этой записью, 0…1. */
	matchScore?: number;
}

/**
 * Справочник пищевой ценности.
 *
 * Отдельный интерфейс, чтобы локальную таблицу можно было заменить внешним
 * API (USDA, Open Food Facts) без единой правки в сканере: pipeline знает
 * только про этот контракт.
 */
export interface NutritionProvider {
	readonly name: string;
	searchFood(query: string): Promise<FoodNutrition[]>;
	getNutrition(foodId: string): Promise<FoodNutrition | null>;
}

export type AiErrorCode =
	| 'INVALID_IMAGE'
	| 'IMAGE_TOO_LARGE'
	| 'NOT_CONFIGURED'
	| 'PROVIDER_AUTH'
	| 'RATE_LIMITED'
	| 'TIMEOUT'
	| 'PROVIDER_ERROR'
	| 'INVALID_AI_RESPONSE'
	| 'NO_FOOD_DETECTED';

/**
 * Ошибка с кодом и HTTP-статусом.
 *
 * message предназначен пользователю, поэтому не должен содержать ключей,
 * стектрейсов и внутренних подробностей провайдера. Исходная причина
 * логируется отдельно на сервере.
 */
export class AiError extends Error {
	constructor(
		readonly code: AiErrorCode,
		message: string,
		readonly status: number,
		readonly cause?: unknown
	) {
		super(message);
		this.name = 'AiError';
	}
}

/**
 * Возвращать ли человеку списанную попытку после неудачи.
 *
 * Деньги здесь идут в обе стороны, поэтому граница одна: получили ли мы
 * от модели ответ. Не получили — не получили и счёта, а человек остался
 * ни с чем: попытка возвращается. Получили — заплатили за вызов.
 *
 * «Не похоже на еду» — именно такой случай: модель посмотрела и честно
 * ответила. Возвращать за это попытку нельзя, иначе десяток снимков кота
 * подряд не стоит человеку ничего, а нам — по два цента за каждый, и суточный
 * предел перестаёт что-либо ограничивать.
 */
export function shouldRefundScan(error: unknown): boolean {
	return !(error instanceof AiError) || error.code !== 'NO_FOOD_DETECTED';
}
