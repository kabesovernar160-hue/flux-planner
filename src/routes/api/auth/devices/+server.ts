import { json } from '@sveltejs/kit';
import { listDeviceSessions, revokeDeviceSession } from '$lib/server/auth/deviceSessions';
import { clearDeviceCookie } from '$lib/server/auth/respond';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Устройства, на которых выполнен вход: список и отзыв по одному.
 *
 * Открывается и из Mini App, и с самого телефона. Текущее устройство
 * помечено, чтобы человек не выкинул себя, думая, что отзывает чужое.
 */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const { user, auth } = await requireUser(request);
		const devices = await listDeviceSessions(await getReadyDb(), user.id);
		const currentId = auth.kind === 'device' ? auth.sessionId : null;

		return json({
			devices: devices.map((device) => ({ ...device, current: device.id === currentId }))
		});
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		logServerError('auth/devices GET', error);
		return apiError('INTERNAL', 'Не удалось получить список устройств', 500);
	}
};

export const DELETE: RequestHandler = async ({ request, cookies }) => {
	let id = '';
	try {
		const body = (await request.json()) as { id?: unknown };
		id = typeof body.id === 'string' ? body.id : '';
	} catch {
		/* ниже ответим, что отзывать нечего */
	}

	if (!id) return apiError('BAD_REQUEST', 'Не указано устройство', 400);

	try {
		const { user, auth } = await requireUser(request);
		const revoked = await revokeDeviceSession(await getReadyDb(), user.id, id);

		if (auth.kind === 'device' && auth.sessionId === id) clearDeviceCookie(cookies);

		return json({ revoked });
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		logServerError('auth/devices DELETE', error);
		return apiError('INTERNAL', 'Не удалось отозвать вход', 500);
	}
};
