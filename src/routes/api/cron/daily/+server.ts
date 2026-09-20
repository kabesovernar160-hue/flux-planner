import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getReadyDb } from '$lib/server/db/client';
import { createRepositories } from '$lib/server/db/repositories';
import { apiError, logServerError } from '$lib/server/errors';
import {
	runBudgetWarnings,
	runDailyNotifications,
	runHabitReminders
} from '$lib/server/notifications/notificationService';
import { purgeExpiredRateLimits } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Сравнение секрета, не зависящее от совпадающего префикса.
 * Обычное === позволяет подобрать секрет по времени ответа.
 */
function secretMatches(provided: string, expected: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * Ежедневная рассылка.
 *
 * Вызывается внешним планировщиком: Vercel Cron, Cloudflare, scheduled function
 * Supabase — любым, кто умеет дёрнуть URL по расписанию. Браузерный setInterval
 * для этого не годится: он работает, только пока у кого-то открыта вкладка.
 *
 * Эндпоинт закрыт секретом. Без него любой желающий смог бы разослать
 * уведомления всем пользователям и сжечь лимиты Bot API.
 */
/**
 * Что рассылаем.
 *
 * Итоги дня — вечером, напоминание о привычках — днём, когда что-то ещё
 * можно успеть. Один эндпоинт с параметром, а не два: рассылка, секрет
 * и уборка у них общие.
 */
function readKind(value: string | null): 'summary' | 'habits' | 'budget' {
	if (value === 'habits') return 'habits';
	if (value === 'budget') return 'budget';
	return 'summary';
}

/**
 * Местный час получателя.
 *
 * Отсутствие параметра означает «всем сразу» — так работали прежние
 * расписания, и менять их поведение молча нельзя. С часом планировщик
 * дёргается ежечасно, а сообщение получают только те, у кого сейчас
 * нужное время.
 *
 * Опечатка в часе не должна превращаться в рассылку всем подряд: «hour=8pm»
 * в crontab обнаружился бы не раньше, чем люди получат сводку среди ночи,
 * поэтому такой вызов отклоняется с ошибкой.
 */
function readHour(value: string | null): number | undefined | 'invalid' {
	if (value === null) return undefined;

	const hour = Number(value);
	return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 'invalid';
}

const run: RequestHandler = async ({ request, url }) => {
	const expected = env.CRON_SECRET?.trim();
	if (!expected) return apiError('NOT_CONFIGURED', 'Планировщик не настроен', 500);

	const provided =
		request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
		request.headers.get('x-cron-secret') ??
		'';

	if (!secretMatches(provided, expected)) {
		return apiError('FORBIDDEN', 'Доступ запрещён', 403);
	}

	try {
		const db = await getReadyDb();
		const users = await createRepositories(db).users.listAll();

		const kind = readKind(url.searchParams.get('kind'));
		const localHour = readHour(url.searchParams.get('hour'));

		if (localHour === 'invalid') {
			return apiError('BAD_HOUR', 'Параметр hour должен быть числом от 0 до 23', 400);
		}

		const result =
			kind === 'habits'
				? await runHabitReminders(db, users, { localHour })
				: kind === 'budget'
					? await runBudgetWarnings(db, users, { localHour })
					: await runDailyNotifications(db, users, { localHour });

		// Попутная уборка: таблица счётчиков иначе копит по строке
		// на каждый новый ключ и никогда не уменьшается.
		await purgeExpiredRateLimits({ db });

		return json({ ...result, kind, total: users.length });
	} catch (error) {
		logServerError('cron/daily', error);
		return apiError('INTERNAL', 'Рассылка не выполнена', 500);
	}
};

export const POST = run;

/**
 * Тот же обработчик на GET.
 *
 * Планировщик Vercel умеет только GET-запросы, а рассылка — действие,
 * и по правилам HTTP ему место в POST. Выбор между «теоретически верным
 * методом» и «работающим расписанием» решён в пользу расписания: эндпоинт
 * в любом случае закрыт секретом, без него он ничего не делает.
 */
export const GET = run;
