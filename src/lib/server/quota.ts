import { and, eq, gt } from 'drizzle-orm';
import type { PlanLimits } from '$lib/billing/plans';
import { msUntilNextMidnight } from '$lib/utils/date';
import { getReadyDb, type Db } from './db/client';
import { rateLimits } from './db/schema';
import { checkRateLimit } from './rateLimit';

/**
 * Суточные квоты тарифа.
 *
 * Отличаются от ограничителя частоты по смыслу, хотя лежат в той же таблице:
 * rate limit защищает сервис от потока запросов, квота — это то, что человек
 * купил. Поэтому окно у квоты привязано к суткам пользователя, а не к минуте,
 * и сбрасывается ровно в его полночь: «3 распознавания в день» должно означать
 * календарный день там, где человек живёт, а не скользящие 24 часа.
 */

export interface QuotaState {
	limit: number;
	used: number;
	remaining: number;
	/** Когда счётчик обнулится, ISO. */
	resetsAt: string;
}

function quotaKey(userId: string, feature: string): string {
	return `quota:${feature}:${userId}`;
}

/**
 * Списание одной единицы квоты.
 *
 * Считает и увеличивает одним запросом — иначе два одновременных
 * распознавания прошли бы по одному и тому же остатку.
 */
export async function consumeScanQuota(
	userId: string,
	limits: PlanLimits,
	options: { db?: Db; timezone?: string; now?: Date } = {}
): Promise<{ allowed: boolean; state: QuotaState }> {
	const now = options.now ?? new Date();
	const windowMs = msUntilNextMidnight(now, options.timezone);

	const result = await checkRateLimit(quotaKey(userId, 'scan'), limits.scansPerDay, windowMs, {
		db: options.db,
		now: now.getTime()
	});

	const used = Math.max(0, limits.scansPerDay - result.remaining);

	return {
		allowed: result.allowed,
		state: {
			limit: limits.scansPerDay,
			used: result.allowed ? used : limits.scansPerDay,
			remaining: result.remaining,
			resetsAt: new Date(now.getTime() + windowMs).toISOString()
		}
	};
}

/**
 * Остаток квоты без списания.
 *
 * Нужен экрану подписки и сканеру: показать «осталось 2 из 3» нельзя
 * тем же вызовом, который тратит попытку.
 */
export async function peekScanQuota(
	userId: string,
	limits: PlanLimits,
	options: { db?: Db; timezone?: string; now?: Date } = {}
): Promise<QuotaState> {
	const now = options.now ?? new Date();
	const windowMs = msUntilNextMidnight(now, options.timezone);
	const fallback: QuotaState = {
		limit: limits.scansPerDay,
		used: 0,
		remaining: limits.scansPerDay,
		resetsAt: new Date(now.getTime() + windowMs).toISOString()
	};

	try {
		const db = options.db ?? (await getReadyDb());

		const [row] = await db
			.select()
			.from(rateLimits)
			.where(
				and(eq(rateLimits.key, quotaKey(userId, 'scan')), gt(rateLimits.resetAt, now.getTime()))
			)
			.limit(1);

		if (!row) return fallback;

		const used = Math.min(limits.scansPerDay, row.count);

		return {
			limit: limits.scansPerDay,
			used,
			remaining: Math.max(0, limits.scansPerDay - used),
			resetsAt: new Date(row.resetAt).toISOString()
		};
	} catch (error) {
		// Не смогли прочитать счётчик — показываем полный остаток.
		// Ошибка в отображении лучше, чем сломанный экран подписки;
		// само списание всё равно идёт через базу и врать не даст.
		console.error('[quota] не удалось прочитать счётчик', error);
		return fallback;
	}
}
