import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { createTestDb, runMigrations } from './client';
import { MIGRATIONS } from './migrations';
import * as schema from './schema';

function freshDb() {
	return drizzle(createClient({ url: 'file::memory:' }), { schema });
}

describe('миграции', () => {
	it('применяются к пустой базе и создают все таблицы', async () => {
		const db = freshDb();
		const applied = await runMigrations(db);

		expect(applied).toEqual(MIGRATIONS.map((migration) => migration.name));

		const tables = await db.run(
			"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
		);
		const names = tables.rows.map((row) => String(row.name));

		for (const table of [
			'users',
			'planner_state',
			'food_entries',
			'habits',
			'habit_completions',
			'finance_entries',
			'daily_nutrition',
			'daily_finance',
			'pending_scans',
			'rate_limits',
			'referral_codes',
			'referrals'
		]) {
			expect(names).toContain(table);
		}
	});

	it('рефералы добавляются к базе, где уже есть люди и записи', async () => {
		// Прод живёт на схеме до рефералов: шаг обязан лечь поверх неё
		// и не тронуть ни пользователей, ни подписки.
		const db = freshDb();
		const client = (db as unknown as { session: { client: import('@libsql/client').Client } })
			.session.client;
		const before = MIGRATIONS.filter((migration) => migration.name < '0008_referrals');

		await client.execute(
			'CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
		);
		for (const migration of before) {
			for (const sql of migration.statements) await client.execute(sql);
			await client.execute({
				sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
				args: [migration.name, '2026-01-01T00:00:00.000Z']
			});
		}

		const stamp = '2026-01-01T00:00:00.000Z';
		await client.execute({
			sql: `INSERT INTO users (id, telegram_user_id, created_at, updated_at) VALUES ('u1', '42', ?, ?)`,
			args: [stamp, stamp]
		});
		await client.execute({
			sql: `INSERT INTO subscriptions (user_id, plan, status, expires_at, created_at, updated_at)
			      VALUES ('u1', 'pro', 'active', '2026-02-01T00:00:00.000Z', ?, ?)`,
			args: [stamp, stamp]
		});

		expect(await runMigrations(db)).toEqual(['0008_referrals']);

		const users = await client.execute('SELECT id FROM users');
		const subscription = await client.execute('SELECT expires_at FROM subscriptions');
		const referrals = await client.execute('SELECT COUNT(*) AS n FROM referrals');

		expect(users.rows.map((row) => row.id)).toEqual(['u1']);
		expect(subscription.rows[0].expires_at).toBe('2026-02-01T00:00:00.000Z');
		expect(Number(referrals.rows[0].n)).toBe(0);
	});

	it('повторный запуск ничего не делает', async () => {
		const db = await createTestDb();

		// Идемпотентность здесь не украшение: миграции выполняются на каждом
		// старте, а инстансов может быть несколько.
		expect(await runMigrations(db)).toEqual([]);
	});

	it('имена шагов уникальны', async () => {
		const names = MIGRATIONS.map((migration) => migration.name);

		expect(new Set(names).size).toBe(names.length);
	});

	it('порядок шагов зафиксирован именами', () => {
		// Перестановка шагов на уже развёрнутой базе разъехалась бы
		// с отметками о применении, поэтому имена нумерованные.
		const sorted = [...MIGRATIONS].map((migration) => migration.name).sort();

		expect(MIGRATIONS.map((migration) => migration.name)).toEqual(sorted);
	});
});
