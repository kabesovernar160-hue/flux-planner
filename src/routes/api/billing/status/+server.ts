import { json } from '@sveltejs/kit';
import { PLANS } from '$lib/billing/plans';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getEntitlement } from '$lib/server/billing/subscriptions';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import { peekScanQuota } from '$lib/server/quota';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Что доступно этому пользователю.
 *
 * Единственный источник правды о тарифе — сервер. Клиент показывает то, что
 * ответили здесь, и не решает ничего сам: иначе «про» включался бы правкой
 * состояния в браузере.
 */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const { user } = await requireUser(request);
		const db = await getReadyDb();

		const entitlement = await getEntitlement(db, user.id);
		const quota = await peekScanQuota(user.id, entitlement.limits, {
			db,
			timezone: user.timezone
		});

		return json({
			plan: entitlement.plan,
			status: entitlement.status,
			expiresAt: entitlement.expiresAt,
			limits: entitlement.limits,
			scans: quota,
			plans: PLANS
		});
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		logServerError('billing/status', error);
		return apiError('INTERNAL', 'Не удалось получить статус подписки', 500);
	}
};
