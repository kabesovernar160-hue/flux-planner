import { json } from '@sveltejs/kit';
import { REFERRAL_CAP_DAYS, REFERRAL_REWARD_DAYS, referralLink } from '$lib/billing/referral';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getConfig } from '$lib/server/config';
import { getReadyDb } from '$lib/server/db/client';
import { apiError, logServerError } from '$lib/server/errors';
import { getReferralSummary } from '$lib/server/referrals/referrals';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Ссылка-приглашение и счётчик.
 *
 * Ссылку собирает сервер: имя бота живёт в его конфигурации, и тестовый
 * бот не должен раздавать ссылки на боевой. Код выдаётся при первом
 * обращении — у тех, кто ни разу не открыл экран, его нет.
 */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const { user } = await requireUser(request);
		const summary = await getReferralSummary(await getReadyDb(), user.id);

		return json({
			link: referralLink(summary.code, getConfig().botUsername),
			invited: summary.invited,
			pending: summary.pending,
			earnedDays: summary.earnedDays,
			rewardDays: REFERRAL_REWARD_DAYS,
			capDays: REFERRAL_CAP_DAYS
		});
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		logServerError('referrals', error);
		return apiError('INTERNAL', 'Не удалось получить приглашение', 500);
	}
};
