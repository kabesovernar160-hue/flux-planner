import { json } from '@sveltejs/kit';
import { runFoodScan } from '$lib/server/ai';
import { readImage } from '$lib/server/ai/image';
import { AiError } from '$lib/server/ai/types';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { getEntitlement } from '$lib/server/billing/subscriptions';
import { getReadyDb } from '$lib/server/db/client';
import { consumeScanQuota } from '$lib/server/quota';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

/**
 * Корневой layout объявляет prerender = true, и это правило распространяется
 * на вложенные эндпоинты. POST предрендерить невозможно, поэтому отключаем
 * явно — иначе сборка падает на этом маршруте.
 */
export const prerender = false;

/**
 * Потолок времени функции на Vercel.
 *
 * Распознавание ходит к провайдеру и на тяжёлой фотографии отвечает
 * десятки секунд. Значение по умолчанию обрывает запрос раньше ответа,
 * и человек видит ошибку там, где всё работало. На собственном сервере
 * параметр игнорируется.
 */
export const config = { maxDuration: 60 };

/** Десять распознаваний в минуту: обычному человеку хватает с запасом. */
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * Грубый предел по адресу — до проверки подписи.
 *
 * Считать по пользователю точнее, но чтобы узнать пользователя, надо сходить
 * в базу. Этот предел защищает как раз от потока запросов без подписи, которые
 * до пользователя не доходят.
 */
const ANONYMOUS_LIMIT = 30;

function rateLimited(retryAfterSeconds: number): Response {
	return json(
		{ error: { code: 'RATE_LIMITED', message: 'Слишком много запросов. Подождите немного' } },
		{ status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
	);
}

/**
 * Распознавание блюда по фотографии.
 *
 * Эндпоинт закрыт подписью Telegram: он тратит деньги на каждом вызове и пишет
 * от имени конкретного пользователя. Открытым его оставлять нельзя.
 *
 * Изображение живёт только в памяти обработчика: на диск не пишется, в базу
 * не кладётся, после ответа теряется вместе с запросом. Дневнику нужен
 * результат, а не снимок.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const address = getClientAddress();
	const anonymous = await checkRateLimit(`analyze:ip:${address}`, ANONYMOUS_LIMIT, RATE_WINDOW_MS);
	if (!anonymous.allowed) return rateLimited(anonymous.retryAfterSeconds);

	try {
		// Пользователь берётся из проверенной подписи initData. Ничему,
		// что клиент сообщил о себе в теле запроса, доверять нельзя.
		const { user } = await requireUser(request);

		const limit = await checkRateLimit(`analyze:user:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
		if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

		// Суточная квота тарифа — это не защита от потока запросов, а то,
		// что человек купил. Проверяется до чтения файла: незачем принимать
		// пять мегабайт, чтобы потом отказать.
		const db = await getReadyDb();
		const entitlement = await getEntitlement(db, user.id);
		const quota = await consumeScanQuota(user.id, entitlement.limits, {
			db,
			timezone: user.timezone
		});

		if (!quota.allowed) {
			return json(
				{
					error: {
						code: 'QUOTA_EXCEEDED',
						message: `Распознавания на сегодня закончились: ${quota.state.limit} в день на вашем тарифе`
					},
					quota: quota.state,
					plan: entitlement.plan
				},
				{ status: 402 }
			);
		}

		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			// Тело не multipart или оборвалось на полпути.
			return apiError('INVALID_REQUEST', 'Ожидается форма с полем image', 400);
		}

		const image = await readImage(form.get('image'));
		const result = await runFoodScan(image);

		// Остаток возвращается вместе с результатом: сканер показывает его
		// сразу, без отдельного запроса за статусом.
		return json({ result, quota: quota.state, plan: entitlement.plan });
	} catch (error) {
		if (error instanceof AuthError) {
			return apiError(error.code, error.message, error.status);
		}

		if (error instanceof AiError) {
			// Причину пишем в лог, наружу отдаём только безопасный текст.
			logServerError(`nutrition/analyze:${error.code}`, error.cause ?? error);
			return apiError(error.code, error.message, error.status);
		}

		logServerError('nutrition/analyze', error);
		return apiError('INTERNAL', 'Не удалось обработать запрос', 500);
	}
};
