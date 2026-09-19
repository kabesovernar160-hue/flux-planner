import { getHour } from './date';

/**
 * Приёмы пищи.
 *
 * Плоский список съеденного за день отвечает на вопрос «сколько», но не
 * отвечает на вопрос «где я перебрал». Разбивка по приёмам — то, ради чего
 * дневник вообще перечитывают: она же даёт быстрый повтор вчерашнего
 * завтрака и делает список читаемым, когда записей не три, а пятнадцать.
 */

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

export type MealType = (typeof MEALS)[number];

export const MEAL_LABELS: Record<MealType, string> = {
	breakfast: 'Завтрак',
	lunch: 'Обед',
	dinner: 'Ужин',
	snack: 'Перекус'
};

export function isMealType(value: unknown): value is MealType {
	return typeof value === 'string' && (MEALS as readonly string[]).includes(value);
}

/**
 * Приём пищи по часу суток.
 *
 * Границы выбраны под обычный день, а не под идеальный режим: съеденное
 * в два часа ночи — перекус, а не завтрак, и записывать его в завтрак
 * значило бы испортить статистику завтраков ради формальной полноты.
 *
 * Это только предположение. Человек всегда может переставить приём руками —
 * именно поэтому оно и предлагается, а не навязывается.
 */
export function mealForHour(hour: number): MealType {
	if (hour >= 4 && hour < 11) return 'breakfast';
	if (hour >= 11 && hour < 16) return 'lunch';
	if (hour >= 16 && hour < 22) return 'dinner';
	return 'snack';
}

export function mealForTime(at: Date = new Date(), timeZone?: string): MealType {
	return mealForHour(getHour(at, timeZone));
}

/**
 * Приём пищи записи.
 *
 * У записей, сделанных до появления приёмов, поля нет. Сваливать их в кучу
 * «прочее» — мусор в интерфейсе, а дописывать значение в базу задним числом
 * значит выдумывать данные. Время создания известно, и по нему запись
 * показывается там же, где оказалась бы сегодня: догадка живёт в интерфейсе
 * и в хранилище не попадает.
 */
export function resolveMeal(
	entry: { meal?: MealType | null; createdAt?: string },
	timeZone?: string
): MealType {
	if (isMealType(entry.meal)) return entry.meal;

	const created = entry.createdAt ? new Date(entry.createdAt) : null;
	if (!created || Number.isNaN(created.getTime())) return 'snack';

	return mealForTime(created, timeZone);
}

export interface MealGroup<T> {
	meal: MealType;
	label: string;
	entries: T[];
	calories: number;
}

/**
 * Записи, разложенные по приёмам.
 *
 * Пустые приёмы не возвращаются: четыре заголовка, три из которых пустые,
 * занимают весь экран и ничего не сообщают.
 */
export function groupByMeal<
	T extends { meal?: MealType | null; createdAt?: string; calories: number }
>(entries: T[], timeZone?: string): MealGroup<T>[] {
	const groups = new Map<MealType, T[]>();

	for (const entry of entries) {
		const meal = resolveMeal(entry, timeZone);
		const bucket = groups.get(meal);
		if (bucket) bucket.push(entry);
		else groups.set(meal, [entry]);
	}

	return MEALS.filter((meal) => groups.has(meal)).map((meal) => {
		const items = groups.get(meal) ?? [];
		return {
			meal,
			label: MEAL_LABELS[meal],
			entries: items,
			calories: items.reduce(
				(total, entry) => total + (Number.isFinite(entry.calories) ? entry.calories : 0),
				0
			)
		};
	});
}
