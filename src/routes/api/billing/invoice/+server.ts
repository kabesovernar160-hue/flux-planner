import { json } from '@sveltejs/kit';
import { PLANS, SUBSCRIPTION_PERIOD_SECONDS } from '$lib/billing/plans';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { apiError, logServerError } from '$lib/server/errors';
import { getEntitlement } from '$lib/server/billing/subscriptions';
import { getReadyDb } from '$lib/server/db/client';
import { checkRateLimit } from '$lib/server/rateLimit';
import { createInvoiceLink } from '$lib/server/telegram/botApi';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Ссылка на счёт в звёздах Telegram.
 *
 * Счёт выписывается только на сервере: цена, период и назначение платежа
 * не должны зависеть от того, что прислал клиент. Клиент сообщает лишь,
 * какой тариф он хочет, — всё остальное берётся из описания тарифов.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { user } = await requireUser(request);

		// Создание счёта дёргает Bot API: поток запросов отсюда упрётся
		// в его лимиты и заодно завалит чат пользователя счетами.
		const limit = await checkRateLimit(`invoice:${user.id}`, 10, 60_000);
		if (!limit.allowed) {
			return apiError('RATE_LIMITED', 'Слишком часто. Подождите немного', 429);
		}

		// Вторая подписка поверх активной означала бы два списания в месяц
		// вместо одного. Кнопка на экране и так прячется, но экран мог быть
		// открыт со вчера, а счёт выписывает сервер.
		const entitlement = await getEntitlement(await getReadyDb(), user.id);
		if (entitlement.status === 'active') {
			return apiError('ALREADY_ACTIVE', 'Подписка уже активна', 409);
		}

		const plan = PLANS.pro;

		// payload возвращается в successful_payment и опознаёт платёж:
		// по нему видно, кому и за что начислять.
		const payload = JSON.stringify({ userId: user.id, plan: plan.id, v: 1 });

		const link = await createInvoiceLink({
			title: 'Flux Planner Pro',
			description: `${plan.limits.scansPerDay} распознаваний по фото в день и вся история. Подписка на 30 дней, отменить можно в любой момент.`,
			payload,
			stars: plan.stars,
			label: 'Подписка на 30 дней',
			subscriptionPeriod: SUBSCRIPTION_PERIOD_SECONDS
		});

		return json({ link, stars: plan.stars });
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		logServerError('billing/invoice', error);
		return apiError('PROVIDER_ERROR', 'Не удалось создать счёт. Попробуйте позже', 502);
	}
};
