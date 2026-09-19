import { json } from '@sveltejs/kit';
import { deleteAccountData } from '$lib/server/account/deleteAccount';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getEntitlement } from '$lib/server/billing/subscriptions';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Удаление учётной записи.
 *
 * Отдельный эндпоинт, а не флаг в синхронизации: действие необратимое,
 * и путать его с обычной записью данных нельзя.
 *
 * Подтверждение приходит в теле явным полем. Случайный POST без него ничего
 * не делает — а случайные POST на этот адрес будут: его увидят и в логах
 * браузера, и в истории запросов.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = await checkRateLimit(`account-delete:${getClientAddress()}`, 5, 60_000);
	if (!limit.allowed) {
		return apiError('RATE_LIMITED', 'Слишком часто. Подождите минуту', 429);
	}

	try {
		const { user } = await requireUser(request);

		const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
		if (body.confirm !== true) {
			return apiError('CONFIRM_REQUIRED', 'Удаление требует подтверждения', 400);
		}

		const db = await getReadyDb();

		// Активная подписка списывает звёзды дальше: её отменяет сам человек
		// в настройках Telegram, и молча удалить данные, оставив списания,
		// было бы худшим из возможных исходов.
		const entitlement = await getEntitlement(db, user.id);
		if (entitlement.status === 'active') {
			return apiError(
				'SUBSCRIPTION_ACTIVE',
				'Сначала отмените подписку в настройках Telegram: иначе списания продолжатся',
				409
			);
		}

		const result = await deleteAccountData(db, user.id);

		return json({ deleted: true, removed: result.removed });
	} catch (error) {
		if (error instanceof AuthError) {
			return apiError(error.code, error.message, error.status);
		}

		logServerError('account/delete', error);
		return apiError('INTERNAL', 'Не удалось удалить данные', 500);
	}
};
