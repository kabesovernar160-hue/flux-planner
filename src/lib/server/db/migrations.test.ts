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
			'rate_limits'
		]) {
			expect(names).toContain(table);
		}
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
