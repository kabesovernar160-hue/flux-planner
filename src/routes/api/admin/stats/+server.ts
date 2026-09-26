import { json } from '@sveltejs/kit';
import { isAdminTelegramId } from '$lib/server/admin/access';
import { loadAdminStats } from '$lib/server/admin/stats';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Воронка и источники для владельца.
 *
 * Всем остальным — 404, а не 403, и при ошибке подписи тоже: «запрещено»
 * подтверждало бы, что здесь что-то есть. Ответ не кэшируется: цифры
 * нужны свежие, и промежуточный кэш не должен хранить чужую статистику.
 */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const { user } = await requireUser(request);

		if (!isAdminTelegramId(user.telegramUserId)) {
			return apiError('NOT_FOUND', 'Не найдено', 404);
		}

		const stats = await loadAdminStats(await getReadyDb());
		return json(stats, { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		if (error instanceof AuthError) return apiError('NOT_FOUND', 'Не найдено', 404);

		logServerError('admin/stats', error);
		return apiError('INTERNAL', 'Не удалось посчитать статистику', 500);
	}
};
