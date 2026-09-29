import { json } from '@sveltejs/kit';
import { rotateDeviceSession } from '$lib/server/auth/deviceSessions';
import { authPayload, clearDeviceCookie, setDeviceCookie } from '$lib/server/auth/respond';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Вход приложения на телефоне при запуске: «кто я по этой куке».
 *
 * То же, что /api/auth/telegram для Mini App, плюс ротация: раз в неделю
 * устройство получает новый секрет. Ротация живёт здесь, а не в requireUser,
 * потому что только здесь есть куда записать новую куку, — а сюда
 * приложение приходит при каждом запуске.
 */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const limit = await checkRateLimit(`auth:${getClientAddress()}`, 30, 60_000);
	if (!limit.allowed) return apiError('RATE_LIMITED', 'Слишком много попыток', 429);

	try {
		const session = await requireUser(request);

		if (session.auth.kind === 'device' && session.auth.needsRotation) {
			const rotated = await rotateDeviceSession(await getReadyDb(), {
				id: session.auth.sessionId,
				secretHash: session.auth.secretHash
			});
			if (rotated) setDeviceCookie(cookies, rotated);
		}

		return json({ ...(await authPayload(session)), kind: session.auth.kind });
	} catch (error) {
		if (error instanceof AuthError) {
			// Отозванная или протухшая кука браузеру больше не нужна.
			if (error.status === 401) clearDeviceCookie(cookies);
			return apiError(error.code, error.message, error.status);
		}

		logServerError('auth/session', error);
		return apiError('INTERNAL', 'Не удалось выполнить вход', 500);
	}
};
