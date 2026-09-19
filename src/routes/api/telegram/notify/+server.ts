import { json } from '@sveltejs/kit';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import {
	buildDailySummary,
	sendBudgetWarning,
	sendDailySummary,
	sendHabitReminder
} from '$lib/server/notifications/notificationService';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const prerender = false;

type NotifyKind = 'summary' | 'habits' | 'budget' | 'preview';

/**
 * Уведомление себе по запросу из приложения.
 *
 * Отправить можно только самому себе: получатель берётся из проверенной
 * подписи, а не из тела запроса. Иначе эндпоинт превратился бы в рассыльщик
 * спама по произвольным chat_id.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = await checkRateLimit(`notify:${getClientAddress()}`, 10, 60_000);
	if (!limit.allowed) {
		return apiError('RATE_LIMITED', 'Слишком часто. Подождите минуту', 429);
	}

	try {
		const { user } = await requireUser(request);

		const body = (await request.json().catch(() => ({}))) as { kind?: NotifyKind };
		const kind: NotifyKind = body.kind ?? 'summary';
		const db = await getReadyDb();

		// Предпросмотр ничего не отправляет: им пользуется экран настроек,
		// чтобы показать, как будет выглядеть сводка.
		if (kind === 'preview') {
			return json({ preview: (await buildDailySummary(db, user)).text });
		}

		const delivered =
			kind === 'habits'
				? await sendHabitReminder(db, user)
				: kind === 'budget'
					? await sendBudgetWarning(db, user)
					: await sendDailySummary(db, user);

		return json({ delivered });
	} catch (error) {
		if (error instanceof AuthError) {
			return apiError(error.code, error.message, error.status);
		}

		logServerError('telegram/notify', error);
		return apiError('INTERNAL', 'Не удалось отправить уведомление', 500);
	}
};
