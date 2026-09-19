import { sql } from 'drizzle-orm';
import { getReadyDb, type Db } from './db/client';
import { rateLimits } from './db/schema';

/**
 * Ограничитель частоты запросов.
 *
 * Счётчики живут в базе, а не в памяти процесса. Это не перфекционизм:
 * в памяти предел обнуляется при каждом развёртывании и считается отдельно
 * на каждом инстансе, то есть платный вызов распознавания можно раскрутить
 * простым чередованием или перезапуском. Для продукта, где каждый вызов
 * стоит денег, это дыра в кармане.
 *
 * Окно фиксированное, а не скользящее: на границе окна теоретически можно
 * сделать двойную порцию запросов. Для защиты от перебора и случайного
 * зацикливания этого достаточно, а стоит фиксированное окно одну запись
 * в базе вместо журнала всех обращений.
 */

export interface RateLimitResult {
	allowed: boolean;
	/** Сколько секунд ждать до следующей попытки. */
	retryAfterSeconds: number;
	/** Сколько попыток осталось в текущем окне. */
	remaining: number;
}

const ALLOWED_FALLBACK: RateLimitResult = {
	allowed: true,
	retryAfterSeconds: 0,
	remaining: 0
};

/**
 * Проверка и увеличение счётчика одним запросом.
 *
 * Считать «прочитали, прибавили, записали» тремя шагами нельзя: два
 * одновременных запроса прочитают одно и то же значение, и предел разойдётся.
 * Здесь всё делает один upsert, а решение принимается по его результату.
 */
export async function checkRateLimit(
	key: string,
	limit: number,
	windowMs: number,
	options: { db?: Db; now?: number } = {}
): Promise<RateLimitResult> {
	const now = options.now ?? Date.now();
	const resetAt = now + windowMs;

	try {
		const db = options.db ?? (await getReadyDb());

		const [row] = await db
			.insert(rateLimits)
			.values({ key, count: 1, resetAt })
			.onConflictDoUpdate({
				target: rateLimits.key,
				// Протухшее окно начинается заново, живое — увеличивается.
				set: {
					count: sql`CASE WHEN ${rateLimits.resetAt} <= ${now} THEN 1 ELSE ${rateLimits.count} + 1 END`,
					resetAt: sql`CASE WHEN ${rateLimits.resetAt} <= ${now} THEN ${resetAt} ELSE ${rateLimits.resetAt} END`
				}
			})
			.returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });

		if (!row) return ALLOWED_FALLBACK;

		const allowed = row.count <= limit;

		return {
			allowed,
			retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((row.resetAt - now) / 1000)),
			remaining: Math.max(0, limit - row.count)
		};
	} catch (error) {
		// База недоступна. Запирать вход из-за ограничителя нельзя: это
		// превратит частичный сбой в полный отказ. Пропускаем, но говорим
		// об этом в логах.
		console.error('[rateLimit] счётчик недоступен', error);
		return ALLOWED_FALLBACK;
	}
}

/**
 * Уборка протухших окон.
 *
 * Без неё таблица растёт на каждый новый ключ и никогда не уменьшается.
 * Вызывается из ежедневного cron — отдельного планировщика ради одной
 * операции заводить незачем.
 */
export async function purgeExpiredRateLimits(
	options: { db?: Db; now?: number } = {}
): Promise<void> {
	const now = options.now ?? Date.now();

	try {
		const db = options.db ?? (await getReadyDb());
		await db.delete(rateLimits).where(sql`${rateLimits.resetAt} <= ${now}`);
	} catch (error) {
		console.error('[rateLimit] уборка не выполнена', error);
	}
}
