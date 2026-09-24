/**
 * Перенос базы целиком: с файла на удалённую libSQL и обратно.
 *
 * Нужен при переезде с отладочного файла рядом с проектом на облачную базу
 * (Turso) и для обратной выгрузки с прода в файл перед рискованной правкой.
 * Люди, уже записавшие в дневник месяц жизни, не должны начинать заново
 * из-за того, что приложение сменило адрес.
 *
 * Запуск:
 *   node scripts/migrate-db.ts
 *
 * Откуда и куда:
 *   SOURCE_DATABASE_URL       по умолчанию DATABASE_URL из .env или файл рядом
 *   SOURCE_DATABASE_AUTH_TOKEN
 *   TARGET_DATABASE_URL       обязательно
 *   TARGET_DATABASE_AUTH_TOKEN
 *
 * Перенос идемпотентен: строки переписываются по первичному ключу, поэтому
 * повторный запуск догоняет то, что изменилось, а не удваивает данные.
 * Порядок таблиц — от родителей к детям: внешние ключи не дадут вставить
 * запись раньше её пользователя.
 */

import { createClient, type Client } from '@libsql/client';
import { MIGRATIONS } from '../src/lib/server/db/migrations.ts';

/** Родители первыми. Порядок менять нельзя: на нём держатся внешние ключи. */
const TABLES = [
	'users',
	'planner_state',
	'food_entries',
	'habits',
	'habit_completions',
	'finance_entries',
	'plan_items',
	'weight_entries',
	'daily_nutrition',
	'daily_finance',
	'subscriptions',
	'payments',
	'capture_tokens',
	'referral_codes',
	'referrals'
];

/**
 * Что не переносится и почему.
 *
 * pending_scans — разборы, ждущие подтверждения в чате прямо сейчас; они
 * живут минуты. rate_limits — счётчики запросов, которые обнулятся сами.
 * Тащить их через переезд значит переносить мусор.
 */
const SKIPPED = ['pending_scans', 'rate_limits'];

/** Сколько строк отправляется одним пакетом. */
const BATCH = 200;

function normalizeFileUrl(url: string): string {
	if (url.startsWith('file:') || url.startsWith('libsql:') || url.startsWith('http')) return url;
	return `file:${url}`;
}

function connect(url: string, authToken?: string): Client {
	const normalized = normalizeFileUrl(url);
	return normalized.startsWith('file:')
		? createClient({ url: normalized })
		: createClient({ url: normalized, authToken });
}

function env(name: string): string {
	return process.env[name]?.trim() ?? '';
}

/** Схема на приёмнике: пустая база иначе откажет на первой же вставке. */
async function ensureSchema(client: Client): Promise<void> {
	await client.execute(
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			name TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`
	);

	const applied = new Set(
		(await client.execute('SELECT name FROM schema_migrations')).rows.map((row) => String(row.name))
	);

	for (const migration of MIGRATIONS) {
		if (applied.has(migration.name)) continue;

		await client.batch(
			[
				...migration.statements.map((sql) => ({ sql, args: [] })),
				{
					sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
					args: [migration.name, new Date().toISOString()]
				}
			],
			'write'
		);
	}
}

async function tableExists(client: Client, table: string): Promise<boolean> {
	const result = await client.execute({
		sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
		args: [table]
	});

	return result.rows.length > 0;
}

async function copyTable(source: Client, target: Client, table: string): Promise<number> {
	if (!(await tableExists(source, table))) return 0;

	const rows = (await source.execute(`SELECT * FROM ${table}`)).rows;
	if (rows.length === 0) return 0;

	const columns = Object.keys(rows[0]);
	const placeholders = columns.map(() => '?').join(', ');
	const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

	for (let index = 0; index < rows.length; index += BATCH) {
		await target.batch(
			rows.slice(index, index + BATCH).map((row) => ({
				sql,
				args: columns.map((column) => row[column] ?? null)
			})),
			'write'
		);
	}

	return rows.length;
}

async function main(): Promise<void> {
	try {
		process.loadEnvFile?.('.env');
	} catch {
		/* переменные могут приходить из окружения процесса */
	}

	const sourceUrl = env('SOURCE_DATABASE_URL') || env('DATABASE_URL') || 'file:flux-planner.db';
	const targetUrl = env('TARGET_DATABASE_URL');

	if (!targetUrl) {
		console.error('[migrate] Не задан TARGET_DATABASE_URL — куда переносить, неизвестно.');
		process.exit(1);
	}

	if (normalizeFileUrl(sourceUrl) === normalizeFileUrl(targetUrl)) {
		console.error('[migrate] Источник и приёмник совпадают.');
		process.exit(1);
	}

	const source = connect(sourceUrl, env('SOURCE_DATABASE_AUTH_TOKEN') || undefined);
	const target = connect(targetUrl, env('TARGET_DATABASE_AUTH_TOKEN') || undefined);

	// Адреса печатаются без токенов: журнал деплоя — не место для ключей.
	console.log(`[migrate] ${sourceUrl.split('?')[0]} → ${targetUrl.split('?')[0]}`);

	await ensureSchema(target);

	let total = 0;

	for (const table of TABLES) {
		const copied = await copyTable(source, target, table);
		total += copied;
		console.log(`[migrate] ${table}: ${copied}`);
	}

	console.log(`[migrate] Перенесено строк: ${total}. Пропущено намеренно: ${SKIPPED.join(', ')}.`);

	source.close();
	target.close();
}

void main();
