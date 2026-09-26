import type { Client } from '@libsql/client';
import { collectStats, type AdminStats, type QueryFn } from '$lib/stats/metrics';
import type { Db } from '../db/client';

/**
 * Запросы статистики — прямо в клиент libSQL.
 *
 * Расчёт общий со скриптом scripts/stats.ts, а тот работает без Drizzle.
 * Общий знаменатель у них — «выполни SQL и отдай строки».
 */
export function queryFor(db: Db): QueryFn {
	const client = (db as unknown as { session: { client: Client } }).session.client;

	return async (sql, args = []) =>
		(await client.execute({ sql, args })).rows as unknown as Record<string, unknown>[];
}

export function loadAdminStats(db: Db, now: Date = new Date()): Promise<AdminStats> {
	return collectStats(queryFor(db), now);
}
