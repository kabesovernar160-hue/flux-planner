import type { Repositories, SyncRow } from '../db/repositories';

/**
 * Имена коллекций в протоколе синхронизации.
 *
 * Строковые ключи, а не индексы: добавление коллекции не должно ломать
 * совместимость со старыми клиентами, которые о ней ещё не знают.
 */
export const SYNC_COLLECTIONS = [
	'food',
	'habits',
	'completions',
	'finance',
	'weight',
	'nutritionDays',
	'financeDays',
	'plan'
] as const;

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export type SyncPayload = Partial<Record<SyncCollection, SyncRow[]>>;

export interface PullResponse {
	changes: SyncPayload;
	/** Отметка для следующего запроса. Клиент хранит её и присылает как since. */
	serverTime: string;
	schemaVersion: number;
	settings: unknown;
	/**
	 * Когда настройки менялись в последний раз.
	 *
	 * Без неё клиент не мог решить, чья версия свежее, и настройки ездили
	 * только в одну сторону: на сервер.
	 */
	settingsUpdatedAt: string | null;
}

export interface PushResponse {
	applied: Partial<Record<SyncCollection, number>>;
	serverTime: string;
}

/** Потолок на пакет: защита от запроса, который положит процесс. */
export const MAX_ROWS_PER_COLLECTION = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoString(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * Проверка формы пришедшей записи.
 *
 * Полезные поля намеренно не валидируются построчно: их набор у шести таблиц
 * разный, а базу от мусора защищают NOT NULL и типы колонок. Здесь проверяется
 * только то, на чём держится сам протокол — ключ и отметки времени.
 */
export function isSyncRow(value: unknown): value is SyncRow {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		value.id.length > 0 &&
		isIsoString(value.createdAt) &&
		isIsoString(value.updatedAt) &&
		(value.deletedAt === undefined || value.deletedAt === null || isIsoString(value.deletedAt))
	);
}

export type ParsedPush = { ok: true; payload: SyncPayload } | { ok: false; error: string };

export function parsePushPayload(body: unknown): ParsedPush {
	if (!isRecord(body)) return { ok: false, error: 'Ожидается объект с полем changes' };

	const changes = body.changes;
	if (!isRecord(changes)) return { ok: false, error: 'Поле changes отсутствует' };

	const payload: SyncPayload = {};

	for (const collection of SYNC_COLLECTIONS) {
		const rows = changes[collection];
		if (rows === undefined) continue;

		if (!Array.isArray(rows)) {
			return { ok: false, error: `Коллекция ${collection} должна быть массивом` };
		}

		if (rows.length > MAX_ROWS_PER_COLLECTION) {
			return { ok: false, error: `Слишком большой пакет в коллекции ${collection}` };
		}

		// Негодные записи отбрасываются молча, а не роняют весь пакет: одна
		// испорченная строка не должна блокировать синхронизацию остальных.
		payload[collection] = rows.filter(isSyncRow);
	}

	return { ok: true, payload };
}

const REPOSITORY_BY_COLLECTION: Record<SyncCollection, keyof Repositories> = {
	food: 'food',
	habits: 'habits',
	completions: 'completions',
	finance: 'finance',
	weight: 'weight',
	nutritionDays: 'nutritionDays',
	financeDays: 'financeDays',
	plan: 'plan'
};

export function repositoryFor(repositories: Repositories, collection: SyncCollection) {
	return repositories[REPOSITORY_BY_COLLECTION[collection]] as {
		pullSince(userId: string, since: string | null): Promise<SyncRow[]>;
		upsertMany(userId: string, rows: SyncRow[]): Promise<number>;
	};
}
