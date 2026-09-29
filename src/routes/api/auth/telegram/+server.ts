import { json } from '@sveltejs/kit';
import { authPayload } from '$lib/server/auth/respond';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Вход по данным запуска Mini App.
 *
 * Отдельного токена сессии не выдаётся: строка запуска и так приходит
 * с каждым запросом и проверяется на месте. Эндпоинт нужен, чтобы клиент мог
 * заранее узнать, кто он для сервера, и не выяснять это на первой же
 * синхронизации.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = await checkRateLimit(`auth:${getClientAddress()}`, 30, 60_000);
	if (!limit.allowed) {
		return apiError('RATE_LIMITED', 'Слишком много попыток', 429);
	}

	try {
		return json(await authPayload(await requireUser(request)));
	} catch (error) {
		if (error instanceof AuthError) {
			return apiError(error.code, error.message, error.status);
		}

		logServerError('auth/telegram', error);
		return apiError('INTERNAL', 'Не удалось выполнить вход', 500);
	}
};
