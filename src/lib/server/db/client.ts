import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { getConfig, isRemoteDatabase } from '../config';
import { MIGRATIONS } from './migrations';
import * as schema from './schema';

export type Db = LibSQLDatabase<typeof schema>;

/**
 * Одна база и один драйвер для всех окружений.
 *
 * libSQL — это SQLite, умеющий работать и как локальный файл, и как удалённая
 * база по HTTP. Значит, на ноутбуке схема, запросы и поведение ровно те же,
 * что на проде: «у меня работало» перестаёт быть отдельным классом ошибок.
 *
 * Драйвер асинхронный намеренно. Синхронный (better-sqlite3) удобнее в коде,
 * но привязывает к файлу на диске рядом с процессом — то есть к одному
 * инстансу, который теряет данные при каждом развёртывании.
 *
 * Локально: DATABASE_URL=file:flux-planner.db
 * На хостинге: DATABASE_URL=libsql://…  +  DATABASE_AUTH_TOKEN=…
 */

let instance: Db | null = null;
let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

function createDbClient(url: string, authToken?: string): Client {
	return createClient(isRemoteDatabase(url) ? { url, authToken } : { url: normalizeFileUrl(url) });
}

/**
 * Приведение пути к виду, который понимает libSQL.
 *
 * Драйвер принимает только URL со схемой: голый путь `flux-planner.db`
 * он отвергает, хотя именно так его удобно писать в .env.
 */
function normalizeFileUrl(url: string): string {
	if (url.startsWith('file:')) return url;
	if (url === ':memory:') return 'file::memory:';
	return `file:${url}`;
}

export function getDb(): Db {
	if (!instance) {
		const config = getConfig();
		client = createDbClient(config.databaseUrl, config.databaseAuthToken || undefined);
		instance = drizzle(client, { schema });
	}

	return instance;
}

/**
 * База, готовая к запросам.
 *
 * Миграции применяются один раз на процесс и ждутся здесь: полагаться только
 * на хук старта нельзя — тесты, скрипты и обработчик вебхука приходят
 * в базу своими путями, и «таблицы ещё нет» не должно зависеть от того,
 * кто попал первым.
 */
export async function getReadyDb(): Promise<Db> {
	const db = getDb();
	await ensureSchema(db);
	return db;
}

/**
 * Применение миграций.
 *
 * Идемпотентно и безопасно для параллельного вызова: шаги выполняются в одной
 * транзакции и отмечаются в служебной таблице. Вызывается один раз на старте
 * сервера (hooks.server.ts) и в тестах при создании базы.
 */
export function ensureSchema(db: Db = getDb()): Promise<void> {
	schemaReady ??= runMigrations(db).then(() => undefined);
	return schemaReady;
}

export async function runMigrations(db: Db): Promise<string[]> {
	const session = (db as unknown as { session: { client: Client } }).session.client;

	await session.execute(
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			name TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`
	);

	const applied = new Set(
		(await session.execute('SELECT name FROM schema_migrations')).rows.map((row) =>
			String(row.name)
		)
	);

	const performed: string[] = [];

	for (const migration of MIGRATIONS) {
		if (applied.has(migration.name)) continue;

		// Шаг целиком или ничего: половина применённой миграции — худшее
		// состояние из возможных, потому что дальше неясно, с чего продолжать.
		await session.batch(
			[
				...migration.statements.map((sql) => ({ sql, args: [] })),
				{
					sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
					args: [migration.name, new Date().toISOString()]
				}
			],
			'write'
		);

		performed.push(migration.name);
	}

	return performed;
}

/** Проверка доступности базы для health-эндпоинта. */
export async function pingDb(db: Db = getDb()): Promise<boolean> {
	try {
		const session = (db as unknown as { session: { client: Client } }).session.client;
		await session.execute('SELECT 1');
		return true;
	} catch {
		return false;
	}
}

/**
 * Только для тестов: отдельная база в памяти на каждый случай,
 * уже с применёнными миграциями.
 */
export async function createTestDb(): Promise<Db> {
	const db = drizzle(createClient({ url: 'file::memory:' }), { schema });
	await runMigrations(db);
	return db;
}

/** Только для тестов: сбросить соединение между случаями. */
export function resetDbForTests(): void {
	client?.close();
	client = null;
	instance = null;
	schemaReady = null;
}
