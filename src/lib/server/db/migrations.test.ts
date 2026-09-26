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

		// Следующие шаги ложатся следом — важно, что 0008 среди них и ничего не упало.
		expect(await runMigrations(db)).toEqual(
			MIGRATIONS.map((migration) => migration.name).filter((name) => name >= '0008_referrals')
		);

		const users = await client.execute('SELECT id FROM users');
		const subscription = await client.execute('SELECT expires_at FROM subscriptions');
		const referrals = await client.execute('SELECT COUNT(*) AS n FROM referrals');

		expect(users.rows.map((row) => row.id)).toEqual(['u1']);
		expect(subscription.rows[0].expires_at).toBe('2026-02-01T00:00:00.000Z');
		expect(Number(referrals.rows[0].n)).toBe(0);
	});

	it('воронка заполняется задним числом из того, что уже накоплено', async () => {
		// Прод живёт на схеме до 0009: статистика должна быть полезна
		// в первый же день, а не через месяц после выката.
		const db = freshDb();
		const client = (db as unknown as { session: { client: import('@libsql/client').Client } })
			.session.client;

		await client.execute(
			'CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
		);
		for (const migration of MIGRATIONS.filter((item) => item.name < '0009_activity')) {
			for (const sql of migration.statements) await client.execute(sql);
			await client.execute({
				sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
				args: [migration.name, '2026-01-01T00:00:00.000Z']
			});
		}

		const joined = '2026-09-01T10:00:00.000Z';
		for (const id of ['active', 'invited', 'idle']) {
			await client.execute({
				sql: `INSERT INTO users (id, telegram_user_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
				args: [
					id,
					`${id.length}23456789`,
					joined,
					id === 'active' ? '2026-09-08T09:00:00.000Z' : joined
				]
			});
		}
		await client.execute({
			sql: `INSERT INTO referrals (id, inviter_id, invitee_id, invitee_key, status, created_at)
			      VALUES ('r1', 'active', 'invited', 'k', 'pending', ?)`,
			args: [joined]
		});
		// Запись «из прошлого» — восстановлена из файла: первая запись не раньше прихода.
		await client.execute(
			`INSERT INTO habits (id, user_id, created_at, updated_at, name, icon, frequency)
			 VALUES ('h1', 'active', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'Вода', 'drop', 'daily')`
		);
		await client.execute(
			`INSERT INTO food_entries (id, user_id, created_at, updated_at, date, name, calories,
			                           protein, fat, carbs, source)
			 VALUES ('f1', 'active', '2026-09-02T08:00:00.000Z', '2026-09-02T08:00:00.000Z',
			         '2026-09-02', 'Каша', 300, 10, 5, 50, 'manual')`
		);

		await runMigrations(db);

		const users = await client.execute(
			'SELECT id, source, app_opened_at, first_record_at FROM users ORDER BY id'
		);
		expect(users.rows.map((row) => ({ ...row }))).toEqual([
			{ id: 'active', source: 'unknown', app_opened_at: joined, first_record_at: joined },
			{ id: 'idle', source: 'unknown', app_opened_at: joined, first_record_at: null },
			{ id: 'invited', source: 'referral', app_opened_at: joined, first_record_at: null }
		]);

		const days = await client.execute(
			"SELECT date FROM user_activity WHERE user_id = 'active' ORDER BY date"
		);
		// День прихода, день записи, день последнего входа; август — до прихода, отброшен.
		expect(days.rows.map((row) => row.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-08']);

		// Триггер на месте: первая запись нового человека отмечается сама.
		await client.execute(
			`INSERT INTO finance_entries (id, user_id, created_at, updated_at, date, type, amount, category)
			 VALUES ('m1', 'idle', ?, ?, '2026-09-26', 'expense', 100, 'food')`,
			[joined, joined]
		);
		const idle = await client.execute("SELECT first_record_at FROM users WHERE id = 'idle'");
		expect(idle.rows[0].first_record_at).not.toBeNull();
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
