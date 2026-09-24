/**
 * Избранные блюда.
 *
 * Хранятся в настройках пользователя, а не отдельной таблицей: настройки уже
 * синхронизируются между устройствами, а заводить ради списка из десятка
 * блюд новую коллекцию на сервере — значит менять протокол и базу.
 *
 * Настройки сливаются целиком — побеждает свежая версия. Для списка это
 * опасно: звёздочка, поставленная на телефоне, пропала бы, стоило планшету
 * поменять цель калорий. Поэтому список сливается поштучно, по ключу блюда
 * и времени правки, а снятие звёздочки хранится отметкой removedAt —
 * иначе «снял звёздочку» было бы неотличимо от «ещё не знаю о ней».
 *
 * Модуль общий для сервера и клиента: оба сливают одинаково.
 */

export interface FavoriteFood {
	/** Нормализованное название — как у частого и недавнего. */
	key: string;
	name: string;
	grams?: number;
	calories: number;
	protein: number;
	fat: number;
	carbs: number;
	updatedAt: string;
	/** Звёздочку сняли. Отметка остаётся, чтобы снятие доехало до других устройств. */
	removedAt?: string | null;
}

export interface FavoriteSource {
	name: string;
	grams?: number;
	calories: number;
	protein: number;
	fat: number;
	carbs: number;
}

/** Потолок списка: настройки уходят в каждый пакет синхронизации целиком. */
export const MAX_FAVORITES = 60;

export function favoriteKey(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Разбор списка из настроек.
 *
 * Настройки приходят JSON-блобом с любого устройства, в том числе
 * со старой версии приложения, — испорченный элемент отбрасывается,
 * а не роняет весь список.
 */
export function readFavorites(value: unknown): FavoriteFood[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((raw): FavoriteFood[] => {
		if (typeof raw !== 'object' || raw === null) return [];
		const item = raw as Record<string, unknown>;

		if (typeof item.name !== 'string' || item.name.trim() === '') return [];
		if (typeof item.updatedAt !== 'string') return [];
		if (![item.calories, item.protein, item.fat, item.carbs].every(isNumber)) return [];

		return [
			{
				key: favoriteKey(item.name),
				name: item.name.trim(),
				grams: isNumber(item.grams) && item.grams > 0 ? item.grams : undefined,
				calories: item.calories as number,
				protein: item.protein as number,
				fat: item.fat as number,
				carbs: item.carbs as number,
				updatedAt: item.updatedAt,
				removedAt: typeof item.removedAt === 'string' ? item.removedAt : null
			}
		];
	});
}

/** Действующие избранные: без снятых, свежие первыми. */
export function activeFavorites(list: unknown): FavoriteFood[] {
	return readFavorites(list)
		.filter((item) => !item.removedAt)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function isFavorite(list: unknown, name: string): boolean {
	const key = favoriteKey(name);
	return activeFavorites(list).some((item) => item.key === key);
}

/**
 * Поставить или снять звёздочку.
 *
 * Возвращает новый список — настройки в сторе меняются целиком через
 * updateSettings, и мутация на месте прошла бы мимо отметки времени.
 */
export function toggleFavorite(list: unknown, food: FavoriteSource, now: string): FavoriteFood[] {
	const items = readFavorites(list);
	const key = favoriteKey(food.name);
	const existing = items.find((item) => item.key === key);
	const others = items.filter((item) => item.key !== key);

	if (existing && !existing.removedAt) {
		return [...others, { ...existing, updatedAt: now, removedAt: now }];
	}

	const added: FavoriteFood = {
		key,
		name: food.name.trim(),
		grams: food.grams,
		calories: food.calories,
		protein: food.protein,
		fat: food.fat,
		carbs: food.carbs,
		updatedAt: now,
		removedAt: null
	};

	return trim([...others, added]);
}

/**
 * Слияние двух версий списка: по каждому блюду побеждает более свежая правка.
 *
 * Коммутативно и идемпотентно — неважно, в каком порядке и сколько раз
 * встретились версии с телефона и планшета, итог один.
 */
export function mergeFavorites(a: unknown, b: unknown): FavoriteFood[] {
	const merged = new Map<string, FavoriteFood>();

	for (const item of [...readFavorites(a), ...readFavorites(b)]) {
		const current = merged.get(item.key);
		if (!current || item.updatedAt > current.updatedAt) merged.set(item.key, item);
	}

	return trim([...merged.values()]);
}

/**
 * Обрезка по потолку.
 *
 * Первыми уходят старые снятые отметки, затем самые давние избранные:
 * свежую звёздочку терять нельзя, а отметке о снятии полугодовой давности
 * уже некуда доезжать.
 */
function trim(items: FavoriteFood[]): FavoriteFood[] {
	if (items.length <= MAX_FAVORITES) return items;

	return [...items]
		.sort((x, y) => {
			if (Boolean(x.removedAt) !== Boolean(y.removedAt)) return x.removedAt ? 1 : -1;
			return y.updatedAt.localeCompare(x.updatedAt);
		})
		.slice(0, MAX_FAVORITES);
}
