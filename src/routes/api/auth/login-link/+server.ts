import { json } from '@sveltejs/kit';
import {
	issueLoginToken,
	LOGIN_TOKEN_LIMIT,
	LOGIN_TOKEN_WINDOW_MS,
	loginUrl
} from '$lib/server/auth/loginTokens';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Код входа для другого устройства — из самого приложения.
 *
 * То же, что кнопка «📱 Приложение на телефон» в боте, но без выхода в чат:
 * из Mini App ссылка открывается во внешнем браузере, и там сразу
 * получается приложение на главном экране.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const { user } = await requireUser(request);

		const limit = await checkRateLimit(
			`login-token:user:${user.id}`,
			LOGIN_TOKEN_LIMIT,
			LOGIN_TOKEN_WINDOW_MS
		);
		if (!limit.allowed) {
			return apiError('RATE_LIMITED', 'Слишком часто. Подождите пару минут', 429);
		}

		const issued = await issueLoginToken(await getReadyDb(), user.id);

		return json({
			code: issued.code,
			url: loginUrl(url.origin, issued.token),
			expiresAt: issued.expiresAt
		});
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		logServerError('auth/login-link', error);
		return apiError('INTERNAL', 'Не удалось создать код входа', 500);
	}
};
