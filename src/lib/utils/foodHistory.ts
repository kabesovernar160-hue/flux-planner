import type { FoodEntry } from '$lib/types/nutrition';
import { addDays, type DateKey } from './date';
import { MEAL_LABELS, MEALS, resolveMeal, type MealType } from './meals';

/**
 * Частое из истории.
 *
 * Человек ест одно и то же. На третий день ввод «Овсянка, 60 г, 230 ккал»
 * руками превращается в повинность — и это главная причина, по которой
 * пищевые дневники забрасывают вообще.
 *
 * Отдельной сущности «избранное» здесь нет намеренно: список, который надо
 * пополнять руками, никто не пополняет. Частое считается из того, что уже
 * записано, и меняется вместе с привычками человека само.
 */

export interface FrequentFood {
	/** Название в том виде, в каком оно записано в последний раз. */
	name: string;
	grams?: number;
	calories: number;
	protein: number;
	fat: number;
	carbs: number;
	/** Сколько раз встречалось за период. */
	count: number;
	/** День последней записи: при равной частоте свежее идёт выше. */
	lastDate: DateKey;
}

export interface FrequentOptions {
	/** Последний день периода. */
	end: DateKey;
	/** Глубина истории в днях. */
	days?: number;
	limit?: number;
	/**
	 * Приём пищи.
	 *
	 * Утром предлагать вчерашний ужин бессмысленно: в завтрак человек кладёт
	 * одно и то же, и подсказка полезна ровно тогда, когда она из того же
	 * приёма. Без приёма берётся вся история.
	 */
	meal?: MealType;
	timeZone?: string;
}

/** Ключ группировки: «Овсянка» и «овсянка » — одно и то же блюдо. */
export function foodKey(name: string): string {
	return normalize(name);
}

function normalize(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function frequentFoods(entries: FoodEntry[], options: FrequentOptions): FrequentFood[] {
	const { end, days = 30, limit = 6, meal, timeZone } = options;
	const from = addDays(end, -Math.max(1, days) + 1);

	const groups = new Map<string, FrequentFood>();

	for (const entry of entries) {
		if (entry.date < from || entry.date > end) continue;
		if (meal && resolveMeal(entry, timeZone) !== meal) continue;

		const key = normalize(entry.name);
		if (key.length === 0) continue;

		const existing = groups.get(key);

		if (!existing) {
			groups.set(key, {
				name: entry.name.trim(),
				grams: entry.grams,
				calories: entry.calories,
				protein: entry.protein,
				fat: entry.fat,
				carbs: entry.carbs,
				count: 1,
				lastDate: entry.date
			});
			continue;
		}

		existing.count += 1;

		// Значения берутся из последней по дате записи: порция могла
		// поменяться, и подставлять позапрошлогоднюю — значит заставить
		// править её руками каждый раз.
		if (entry.date >= existing.lastDate) {
			existing.name = entry.name.trim();
			existing.grams = entry.grams;
			existing.calories = entry.calories;
			existing.protein = entry.protein;
			existing.fat = entry.fat;
			existing.carbs = entry.carbs;
			existing.lastDate = entry.date;
		}
	}

	// Сначала то, что едят чаще, при равенстве — то, что ели недавнее.
	// Единичные записи тоже в списке: в первую неделю ничего ещё
	// не повторялось, а повторить вчерашнее уже хочется.
	return [...groups.values()]
		.sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))
		.slice(0, Math.max(0, limit));
}

/**
 * Поиск по своим записям.
 *
 * Справочник на две сотни продуктов закрывает основу, но не закрывает
 * «протеиновый батончик такой-то» — а один раз записанное блюдо человек
 * потом ищет именно по названию. Отдельного списка «мои продукты» для этого
 * не нужно: история и есть такой список, только его не надо вести руками.
 */
export function searchHistory(
	entries: FoodEntry[],
	query: string,
	options: { end: DateKey; days?: number; limit?: number } = { end: '9999-12-31' }
): FrequentFood[] {
	const needle = normalize(query);
	if (needle.length < 2) return [];

	const matched = entries.filter((entry) => normalize(entry.name).includes(needle));

	// Глубина по умолчанию больше, чем у подсказок повтора: искать по
	// названию человек идёт как раз за тем, что ел давно и не помнит цифр.
	return frequentFoods(matched, {
		end: options.end,
		days: options.days ?? 365,
		limit: options.limit ?? 4
	});
}

/**
 * Недавнее: последние разные блюда, свежие первыми.
 *
 * Дополняет частое: вчера впервые съеденный суп ещё не «частый», а повторить
 * его сегодня хочется. Порядок — по дню записи, внутри дня — по времени
 * создания; одно блюдо встречается один раз, с последней порцией.
 */
export function recentFoods(
	entries: FoodEntry[],
	options: { end: DateKey; limit?: number }
): FrequentFood[] {
	const { end, limit = 6 } = options;

	const sorted = entries
		.filter((entry) => entry.date <= end && !entry.deletedAt)
		.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

	const seen = new Map<string, FrequentFood>();

	for (const entry of sorted) {
		const key = normalize(entry.name);
		if (key.length === 0) continue;

		const existing = seen.get(key);
		if (existing) {
			existing.count += 1;
			continue;
		}

		seen.set(key, {
			name: entry.name.trim(),
			grams: entry.grams,
			calories: entry.calories,
			protein: entry.protein,
			fat: entry.fat,
			carbs: entry.carbs,
			count: 1,
			lastDate: entry.date
		});
	}

	return [...seen.values()].slice(0, Math.max(0, limit));
}

export interface MealRepeat {
	meal: MealType;
	/** «вчерашний завтрак» — для подписи кнопки. */
	label: string;
	items: FoodEntry[];
	calories: number;
}

const YESTERDAY_LABELS: Record<MealType, string> = {
	breakfast: 'вчерашний завтрак',
	lunch: 'вчерашний обед',
	dinner: 'вчерашний ужин',
	snack: 'вчерашний перекус'
};

/**
 * Какие вчерашние приёмы можно повторить одной кнопкой.
 *
 * Только те, что вчера были, а сегодня ещё пусты: повторить завтрак,
 * когда завтрак уже записан, — верный способ задвоить дневник.
 * Порядок — как у приёмов в течение дня.
 */
export function yesterdayMeals(
	entries: FoodEntry[],
	today: DateKey,
	timeZone?: string
): MealRepeat[] {
	const yesterday = addDays(today, -1);
	const alive = entries.filter((entry) => !entry.deletedAt);

	const mealsToday = new Set(
		alive.filter((entry) => entry.date === today).map((entry) => resolveMeal(entry, timeZone))
	);

	const result: MealRepeat[] = [];

	for (const meal of MEALS) {
		if (mealsToday.has(meal)) continue;

		const items = alive.filter(
			(entry) => entry.date === yesterday && resolveMeal(entry, timeZone) === meal
		);
		if (items.length === 0) continue;

		result.push({
			meal,
			label: YESTERDAY_LABELS[meal] ?? MEAL_LABELS[meal],
			items,
			calories: items.reduce(
				(total, item) => total + (Number.isFinite(item.calories) ? item.calories : 0),
				0
			)
		});
	}

	return result;
}
