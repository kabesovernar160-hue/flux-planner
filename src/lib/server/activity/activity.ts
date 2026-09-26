import { and, eq, isNull, sql } from 'drizzle-orm';
import { createId } from '$lib/utils/id';
import { nowIso } from '$lib/utils/date';
import { normalizeSource, startPayload } from '$lib/stats/metrics';
import { getReadyDb, type Db } from '../db/client';
import { createRepositories } from '../db/repositories';
import { logServerError } from '../errors';
import { userActivity, users, type UserRow } from '../db/schema';

/**
 * Следы для воронки активации: откуда пришёл, когда открыл приложение,
 * в какие дни возвращался.
 *
 * Всё здесь — вспомогательное. Сбой записи не должен стоить человеку
 * ни входа, ни приветствия бота, поэтому вызывающий код ловит ошибки,
 * а не пропускает их наверх.
 */

/**
 * Кому сегодня уже отмечен день — в памяти процесса.
 *
 * Приложение шлёт вход, синхронизацию и десяток запросов подряд; без этой
 * отметки каждый из них делал бы INSERT, который ничего не меняет.
 * Потеря памяти при перезапуске безвредна: вставка идемпотентна,
 * будет одна лишняя на человека.
 */
const markedToday = new Map<string, string>();
const MEMO_LIMIT = 20_000;

export interface VisitResult {
	/** Этот запрос — первое открытие приложения. */
	firstOpen: boolean;
}

/**
 * Вход в Mini App: день присутствия, а при первом открытии — отметка
 * и источник из start_param.
 *
 * Первое открытие ставится условным UPDATE: из двух параллельных запросов
 * (вход и синхронизация уходят одновременно) его совершит ровно один,
 * и только он узнает, что человек здесь впервые. Источник пишется через
 * COALESCE — если /start уже записал метку рекламы, она остаётся.
 */
export async function recordAppVisit(
	db: Db,
	user: Pick<UserRow, 'id' | 'appOpenedAt'>,
	startParam: string | null | undefined,
	now: Date = new Date()
): Promise<VisitResult> {
	const timestamp = now.toISOString();
	const day = timestamp.slice(0, 10);
	let firstOpen = false;

	if (!user.appOpenedAt) {
		const result = await db
			.update(users)
			.set({
				appOpenedAt: timestamp,
				source: sql`COALESCE(${users.source}, ${normalizeSource(startParam)})`
			})
			.where(and(eq(users.id, user.id), isNull(users.appOpenedAt)));

		firstOpen = result.rowsAffected > 0;
	}

	if (markedToday.get(user.id) !== day) {
		await db.insert(userActivity).values({ userId: user.id, date: day }).onConflictDoNothing();

		if (markedToday.size >= MEMO_LIMIT) markedToday.clear();
		markedToday.set(user.id, day);
	}

	return { firstOpen };
}

/** Только для тестов: у каждого случая своя база, а память — общая. */
export function resetActivityMemoForTests(): void {
	markedToday.clear();
}

/**
 * /start в боте: заводит пользователя и запоминает метку рекламы.
 *
 * Строка заводится уже здесь, а не при входе в приложение: иначе человек,
 * пришедший по рекламе и не открывший Mini App, не оставил бы следа,
 * и именно самая дорогая утечка воронки была бы не видна.
 *
 * Метка пишется, только если источника ещё нет: первое касание не
 * перезаписывается ни повторным /start, ни чужой ссылкой.
 *
 * Никогда не бросает: приветствие важнее статистики.
 */
export async function trackBotStart(
	fromId: number | string,
	from: { username?: string; first_name?: string } | undefined,
	text: string,
	options: { db?: Db; now?: string } = {}
): Promise<void> {
	try {
		const db = options.db ?? (await getReadyDb());

		const user = await createRepositories(db).users.upsertFromTelegram({
			id: createId(),
			telegramUserId: String(fromId),
			username: from?.username,
			firstName: from?.first_name,
			now: options.now ?? nowIso()
		});

		if (user.source) return;

		await db
			.update(users)
			.set({ source: normalizeSource(startPayload(text)) })
			.where(and(eq(users.id, user.id), isNull(users.source)));
	} catch (error) {
		logServerError('activity/bot-start', error);
	}
}
