import { json } from '@sveltejs/kit';
import { AuthError, requireUser } from '$lib/server/auth/session';
import {
	getCaptureTokenState,
	issueCaptureToken,
	revokeCaptureTokens
} from '$lib/server/capture/tokens';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Ключ быстрой записи: выдать, посмотреть состояние, отозвать.
 *
 * Отдельно от самой записи: сюда ходит приложение с подписью Telegram,
 * туда — телефон с ключом. Смешивать два способа авторизации в одном
 * эндпоинте значит однажды перепутать, какой из них проверен.
 */

async function session(request: Request) {
	const { user } = await requireUser(request);
	return { user, db: await getReadyDb() };
}

export const GET: RequestHandler = async ({ request }) => {
	try {
		const { user, db } = await session(request);
		return json(await getCaptureTokenState(db, user.id));
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		logServerError('capture/token GET', error);
		return apiError('INTERNAL', 'Не удалось прочитать состояние ключа', 500);
	}
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// Выдача ключа — редкое действие: десяток в час это уже не человек.
	const limit = await checkRateLimit(`capture-token:${getClientAddress()}`, 10, 3_600_000);
	if (!limit.allowed) return apiError('RATE_LIMITED', 'Слишком часто. Попробуйте позже', 429);

	try {
		const { user, db } = await session(request);
		const issued = await issueCaptureToken(db, user.id);

		// Ключ уходит наружу единственный раз в жизни: в базе лежит только
		// его хеш, и показать его повторно неоткуда.
		return json(issued);
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		logServerError('capture/token POST', error);
		return apiError('INTERNAL', 'Не удалось создать ключ', 500);
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const { user, db } = await session(request);
		const revoked = await revokeCaptureTokens(db, user.id);

		return json({ revoked });
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		logServerError('capture/token DELETE', error);
		return apiError('INTERNAL', 'Не удалось отозвать ключ', 500);
	}
};
