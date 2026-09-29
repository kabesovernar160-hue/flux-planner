import { json } from '@sveltejs/kit';
import { createDeviceSession } from '$lib/server/auth/deviceSessions';
import { consumeLoginToken } from '$lib/server/auth/loginTokens';
import { authPayload, setDeviceCookie } from '$lib/server/auth/respond';
import { getReadyDb } from '$lib/server/db/client';
import { createRepositories } from '$lib/server/db/repositories';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Вход на устройстве по коду из бота.
 *
 * Код одноразовый и живёт десять минут; здесь он меняется на долгую сессию
 * устройства в httpOnly-куке. Обмен — только POST из самой страницы входа:
 * GET по ссылке делают и превью ссылок в мессенджерах, и предзагрузка
 * браузера, и каждый такой визит сжигал бы код раньше человека.
 *
 * Предел попыток на адрес закрывает перебор: код короткий, потому что
 * его иногда набирают руками.
 */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const limit = await checkRateLimit(`login:ip:${getClientAddress()}`, 10, 10 * 60_000);
	if (!limit.allowed) {
		return apiError('RATE_LIMITED', 'Слишком много попыток. Подождите несколько минут', 429);
	}

	let token = '';
	try {
		const body = (await request.json()) as { token?: unknown };
		token = typeof body.token === 'string' ? body.token : '';
	} catch {
		return apiError('BAD_REQUEST', 'Нужен код входа', 400);
	}

	try {
		const db = await getReadyDb();
		const user = await consumeLoginToken(db, token);

		if (!user) {
			return apiError(
				'INVALID_TOKEN',
				'Код не подходит: он устарел или уже использован. Попросите у бота новый',
				401
			);
		}

		const issued = await createDeviceSession(db, user.id, {
			userAgent: request.headers.get('user-agent')
		});
		setDeviceCookie(cookies, issued.cookie);

		return json({
			...(await authPayload({ user, repositories: createRepositories(db) })),
			kind: 'device'
		});
	} catch (error) {
		logServerError('auth/login', error);
		return apiError('INTERNAL', 'Не удалось выполнить вход', 500);
	}
};
