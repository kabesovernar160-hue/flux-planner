import { NUTRITION_TABLE, type NutritionRecord } from '$lib/data/nutritionTable';
import type { FoodReference } from '$lib/types/nutrition';

/**
 * Поиск продукта по справочнику.
 *
 * Общий для сервера и клиента: на сервере по нему распознавание превращает
 * «Куриное филе на гриле» в запись справочника, в приложении — подсказывает
 * продукт при ручном вводе. Две отдельные реализации означали бы, что одно
 * и то же название даёт разные калории в зависимости от того, кто спросил.
 */

export interface FoodMatch extends FoodReference {
	/** Насколько уверенно запрос совпал с записью, 0…1. */
	matchScore: number;
}

/** Ниже этого совпадения ответ считается «не нашли». */
export const MATCH_THRESHOLD = 0.55;

/**
 * Длина общего начала, по которой слова считаются одной формой.
 *
 * Русские слова приходят в произвольном падеже и роде: «овощи», «овощами»,
 * «овощная». Полноценная лемматизация ради справочника на две сотни строк
 * не окупается, а общий корень из четырёх букв отделяет эти формы
 * от посторонних слов достаточно надёжно.
 */
const STEM_LENGTH = 4;

export function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/ё/g, 'е')
		.replace(/[^a-zа-я0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function tokenize(text: string): string[] {
	// Предлоги и союзы («на», «с», «и») есть почти в каждом названии
	// и совпадают всегда — в сравнении они только мешают.
	return normalize(text)
		.split(' ')
		.filter((token) => token.length >= 3);
}

function sameWord(a: string, b: string): boolean {
	if (a === b) return true;
	if (a.length < STEM_LENGTH || b.length < STEM_LENGTH) return false;
	return a.slice(0, STEM_LENGTH) === b.slice(0, STEM_LENGTH);
}

/**
 * Насколько запрос похож на название, 0…1.
 *
 * Считается и точность (сколько слов запроса нашлось в названии), и полнота
 * (сколько слов названия закрыто запросом). Без полноты запрос «сыр» одинаково
 * хорошо ложился бы и на «Сыр», и на «Творожный сыр». Точность весит больше:
 * одно совпавшее слово из четырёх — это не найденный продукт.
 */
function similarity(queryTokens: string[], phrase: string): number {
	const phraseTokens = tokenize(phrase);
	if (queryTokens.length === 0 || phraseTokens.length === 0) return 0;

	const matched = queryTokens.filter((token) =>
		phraseTokens.some((candidate) => sameWord(token, candidate))
	).length;

	if (matched === 0) return 0;

	const precision = matched / queryTokens.length;
	const recall = matched / phraseTokens.length;

	return precision * 0.7 + recall * 0.3;
}

function scoreRecord(queryTokens: string[], record: NutritionRecord): number {
	let best = similarity(queryTokens, record.name);

	for (const synonym of record.synonyms) {
		// Синоним чуть дешевле собственного названия: при равном совпадении
		// побеждает запись, названная так же, как спросили.
		best = Math.max(best, similarity(queryTokens, synonym) * 0.97);
	}

	return best;
}

export interface SearchOptions {
	limit?: number;
	/** Порог совпадения. Подсказкам в интерфейсе можно быть смелее расчёта. */
	threshold?: number;
	table?: readonly NutritionRecord[];
}

export function searchFoods(query: string, options: SearchOptions = {}): FoodMatch[] {
	const table = options.table ?? NUTRITION_TABLE;
	const threshold = options.threshold ?? MATCH_THRESHOLD;
	const queryTokens = tokenize(query);

	if (queryTokens.length === 0) return [];

	return table
		.map((record) => ({
			id: record.id,
			name: record.name,
			per100g: record.per100g,
			matchScore: scoreRecord(queryTokens, record)
		}))
		.filter((match) => match.matchScore >= threshold)
		.sort((a, b) => b.matchScore - a.matchScore)
		.slice(0, options.limit ?? 5);
}

export function findFoodById(
	id: string,
	table: readonly NutritionRecord[] = NUTRITION_TABLE
): FoodReference | null {
	const record = table.find((item) => item.id === id);
	if (!record) return null;
	return { id: record.id, name: record.name, per100g: record.per100g };
}

/**
 * Подсказки для поля ввода.
 *
 * Порог ниже, чем у расчёта: человек печатает по одной букве, и показать
 * несколько вариантов «почти похоже» полезнее, чем не показать ничего.
 * Ошибиться здесь нестрашно — выбор всё равно делает человек.
 */
export function suggestFoods(query: string, limit = 6): FoodMatch[] {
	return searchFoods(query, { limit, threshold: 0.3 });
}
