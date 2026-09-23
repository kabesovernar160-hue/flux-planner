/**
 * Чистка дублей, которые оставил dev-сид.
 *
 * Сид демо-данных срабатывал в dev-режиме и внутри Telegram (через туннель):
 * на пустом устройстве он создавал шесть привычек, траты и еду раньше первой
 * синхронизации, и сервер складывал каждый такой набор к настоящим данным.
 * Причина закрыта в +layout.svelte, этот скрипт убирает последствия.
 *
 * Что считается дублем:
 *   привычки — одинаковое название; остаётся самая ранняя, отметки дублей
 *   переезжают на неё (если в тот день отметки ещё не было);
 *   еда и траты — полностью совпадающие записи, созданные вместе с лишним
 *   набором привычек (±2 минуты). Настоящие две одинаковые чашки кофе
 *   за день так не попадут.
 *
 * Записи не стираются, а помечаются удалёнными с новым updated_at:
 * иначе телефон не узнал бы об удалении и прислал бы их обратно.
 *
 * Показать, что будет убрано:
 *   node scripts/dedupe-user.ts 1145673466
 * Убрать:
 *   node scripts/dedupe-user.ts 1145673466 --confirm
 *
 * База берётся из DATABASE_URL, а если он пуст — из TARGET_DATABASE_URL.
 */

import { createClient, type Client, type InStatement } from '@libsql/client';

function env(name: string): string {
	return process.env[name]?.trim() ?? '';
}

function connect(): { client: Client; url: string } {
	const url = env('DATABASE_URL') || env('TARGET_DATABASE_URL');
	if (!url) throw new Error('Не задан ни DATABASE_URL, ни TARGET_DATABASE_URL.');

	const authToken = env('DATABASE_URL')
		? env('DATABASE_AUTH_TOKEN')
		: env('TARGET_DATABASE_AUTH_TOKEN');
	const normalized = url.startsWith('file:') || url.includes('://') ? url : `file:${url}`;

	const client = normalized.startsWith('file:')
		? createClient({ url: normalized })
		: createClient({ url: normalized, authToken: authToken || undefined });
	return { client, url: normalized };
}

type Row = Record<string, unknown>;

const BATCH_WINDOW_MS = 2 * 60 * 1000;

async function main(): Promise<void> {
	try {
		process.loadEnvFile?.('.env');
	} catch {
		/* переменные могут приходить из окружения процесса */
	}

	const args = process.argv.slice(2);
	const confirm = args.includes('--confirm');
	const telegramUserId = args.find((arg) => !arg.startsWith('--'));
	if (!telegramUserId) throw new Error('Укажите telegram id: node scripts/dedupe-user.ts <id>');

	const { client, url } = connect();
	try {
		console.log(`База: ${url.replace(/\/\/[^@/]*@/, '//***@')}`);

		const user = (
			await client.execute({
				sql: 'SELECT id, username FROM users WHERE telegram_user_id = ?',
				args: [telegramUserId]
			})
		).rows[0];
		if (!user) throw new Error(`Пользователь ${telegramUserId} не найден.`);
		const userId = String(user.id);
		console.log(`Пользователь: ${user.username ?? '—'} (${userId})`);

		const live = async (table: string): Promise<Row[]> =>
			(
				await client.execute({
					sql: `SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
					args: [userId]
				})
			).rows as Row[];

		const now = new Date().toISOString();
		const statements: InStatement[] = [];
		const tombstone = (table: string, id: unknown) =>
			statements.push({
				sql: `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
				args: [now, now, id as string]
			});

		// ── Привычки ────────────────────────────────────────────────
		const habits = await live('habits');
		const keeper = new Map<string, Row>();
		const replacedBy = new Map<string, string>();
		const dupeBatches: number[] = [];

		for (const habit of habits) {
			const kept = keeper.get(String(habit.name));
			if (!kept) {
				keeper.set(String(habit.name), habit);
				continue;
			}
			replacedBy.set(String(habit.id), String(kept.id));
			dupeBatches.push(Date.parse(String(habit.created_at)));
			tombstone('habits', habit.id);
		}

		const completions = await live('habit_completions');
		const takenDays = new Set(
			completions
				.filter((c) => !replacedBy.has(String(c.habit_id)))
				.map((c) => `${c.habit_id}|${c.date}`)
		);
		let moved = 0;
		let dropped = 0;
		for (const completion of completions) {
			const target = replacedBy.get(String(completion.habit_id));
			if (!target) continue;
			const key = `${target}|${completion.date}`;
			if (takenDays.has(key)) {
				tombstone('habit_completions', completion.id);
				dropped += 1;
			} else {
				takenDays.add(key);
				statements.push({
					sql: 'UPDATE habit_completions SET habit_id = ?, updated_at = ? WHERE id = ?',
					args: [target, now, completion.id as string]
				});
				moved += 1;
			}
		}

		// ── Еда и траты из тех же наборов ───────────────────────────
		const fromDupeBatch = (row: Row) => {
			const at = Date.parse(String(row.created_at));
			return dupeBatches.some((batch) => Math.abs(batch - at) <= BATCH_WINDOW_MS);
		};

		const dedupe = async (table: string, fields: string[]): Promise<number> => {
			const seen = new Set<string>();
			let count = 0;
			for (const row of await live(table)) {
				const key = fields.map((field) => String(row[field])).join('|');
				if (seen.has(key) && fromDupeBatch(row)) {
					tombstone(table, row.id);
					count += 1;
				} else {
					seen.add(key);
				}
			}
			return count;
		};

		const food = await dedupe('food_entries', ['date', 'name', 'calories', 'grams', 'meal']);
		const finance = await dedupe('finance_entries', ['date', 'type', 'amount', 'category', 'note']);

		console.log(
			`Привычки: ${habits.length} → ${keeper.size} (лишних ${replacedBy.size})\n` +
				`Отметки дублей: перенести ${moved}, убрать ${dropped}\n` +
				`Еда: убрать ${food}\nТраты: убрать ${finance}`
		);

		if (statements.length === 0) {
			console.log('Дублей нет.');
			return;
		}
		if (!confirm) {
			console.log('Это просмотр. Чтобы применить, добавьте --confirm.');
			return;
		}

		await client.batch(statements, 'write');
		console.log(`Готово: изменено ${statements.length} записей.`);
	} finally {
		client.close();
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
