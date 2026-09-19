import type { MealType } from '$lib/utils/meals';
import type { SyncMeta } from './sync';

/** Источник записи о еде: ручной ввод или распознавание по фото. */
export type FoodSource = 'manual' | 'ai';

export interface FoodEntry {
	id: string;
	/** Ключ дня в формате YYYY-MM-DD в часовом поясе пользователя. */
	date: string;
	name: string;
	grams?: number;
	calories: number;
	protein: number;
	fat: number;
	carbs: number;
	source: FoodSource;
	/**
	 * Приём пищи.
	 *
	 * Необязательный: у записей, сделанных до появления приёмов, его нет,
	 * и переписывать их задним числом нельзя — это выдуманные данные.
	 * Для показа приём таким записям подбирается по времени создания.
	 */
	meal?: MealType;
	createdAt: string;
	updatedAt: string;
	/** Надгробие. Заполнено — запись удалена и не показывается. */
	deletedAt?: string | null;
}

/**
 * Цели дня по питанию.
 *
 * Здесь намеренно нет суммарных consumed-полей по калориям и макросам:
 * они однозначно выводятся из FoodEntry, и дублирование быстро разъезжается
 * с реальностью при удалении или правке записей.
 *
 * Вода — исключение: у неё нет записей-источников, поэтому выпитый объём
 * хранится как факт.
 */
export interface DailyNutrition {
	date: string;

	calorieGoal: number;

	proteinGoal: number;
	fatGoal: number;
	carbsGoal: number;

	waterGoalMl: number;
	waterConsumedMl: number;
}

/**
 * Цели дня в хранилище.
 *
 * В документе они лежат под ключом-датой, а в синхронизации ходят строками —
 * отсюда служебные поля. Расчётам нужны только цели, поэтому они принимают
 * DailyNutrition и ничего не знают про идентификаторы.
 */
export type DailyNutritionRecord = DailyNutrition & SyncMeta;

/**
 * Пищевая ценность на 100 граммов продукта.
 *
 * Это единица хранения справочника: «сколько в продукте», а не «сколько
 * на тарелке». Всё, что относится к конкретной порции, считается из неё
 * умножением на вес и пересчитывается заново, когда пользователь правит граммы.
 */
export interface NutritionPer100g {
	calories: number;
	protein: number;
	fat: number;
	carbs: number;
}

/**
 * Запись справочника продуктов.
 *
 * Общая форма для сервера и клиента: по ней считает распознавание и по ней же
 * ищет продукт ручной ввод.
 */
export interface FoodReference {
	id: string;
	name: string;
	per100g: NutritionPer100g;
}

/**
 * Откуда взяты значения на 100 г.
 *
 * Различать обязательно: по справочнику цифры проверяемые, а оценка модели —
 * это предположение, и уверенность по такому продукту заведомо ниже.
 */
export type NutritionSourceKind = 'database' | 'estimate';

/**
 * Один распознанный компонент блюда.
 *
 * Ключевая идея всего сканера: фотография раскладывается на составляющие
 * («курица», «рис», «соус»), а не сводится к одному названию с одной цифрой.
 * Модель оценивает ЧТО и СКОЛЬКО ГРАММОВ, калории считает движок питания —
 * vision-модель не умеет надёжно определять вес, масло и сахар.
 */
export interface FoodScanItem {
	id: string;
	name: string;
	estimatedGrams: number;

	/** Значения для указанного веса. Пересчитываются при правке граммов. */
	calories: number;
	protein: number;
	fat: number;
	carbs: number;

	/** Основа пересчёта: справочник или оценка модели. */
	per100g: NutritionPer100g;
	nutritionSource: NutritionSourceKind;

	/** Уверенность в этом компоненте, 0…1. */
	confidence: number;
	/** Способ приготовления или иная заметка модели. Короткая строка. */
	notes?: string;
}

export interface FoodScanTotals {
	calories: number;
	protein: number;
	fat: number;
	carbs: number;
}

/**
 * Результат распознавания фотографии.
 *
 * Лежит в общих типах, а не в $lib/server: его читает и клиентский компонент
 * подтверждения. Импортировать что-либо из серверной папки в клиентский код
 * нельзя — даже тип, который стирается при сборке.
 */
export interface FoodScanResult {
	items: FoodScanItem[];
	totals: FoodScanTotals;
	/** Уверенность по всему снимку, 0…1. */
	overallConfidence: number;
}

/** Три уровня для интерфейса. Проценты пользователю не показываем. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';
