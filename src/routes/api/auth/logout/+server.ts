import { json } from '@sveltejs/kit';
import { revokeAllDeviceSessions, revokeDeviceSession } from '$lib/server/auth/deviceSessions';
import { clearDeviceCookie } from '$lib/server/auth/respond';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Выход: с этого устройства или со всех сразу.
 *
 * «Везде» отзывает все сессии устройств — телефон, который потерян
 * или отдан, перестаёт видеть дневник на следующем же запросе. Mini App
 * в Telegram это не касается: там сессий нет, пускает подпись клиента.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	let all = false;
	try {
		const body = (await request.json()) as { all?: unknown };
		all = body.all === true;
	} catch {
		// Пустое тело — выход с этого устройства.
	}

	try {
		const { user, auth } = await requireUser(request);
		const db = await getReadyDb();

		const revoked = all
			? await revokeAllDeviceSessions(db, user.id)
			: auth.kind === 'device'
				? Number(await revokeDeviceSession(db, user.id, auth.sessionId))
				: 0;

		if (auth.kind === 'device') clearDeviceCookie(cookies);

		return json({ revoked });
	} catch (error) {
		if (error instanceof AuthError) {
			// Кука уже недействительна — выйти всё равно можно.
			if (error.status === 401) {
				clearDeviceCookie(cookies);
				return json({ revoked: 0 });
			}
			return apiError(error.code, error.message, error.status);
		}

		logServerError('auth/logout', error);
		return apiError('INTERNAL', 'Не удалось выйти', 500);
	}
};
