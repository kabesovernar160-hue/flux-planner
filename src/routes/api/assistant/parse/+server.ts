import { json } from '@sveltejs/kit';
import { resolveIntentProvider } from '$lib/server/ai/intentProvider';
import { AiError } from '$lib/server/ai/types';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

export const prerender = false;

/** Длинный текст почти наверняка не команда планировщику. */
const MAX_TEXT_LENGTH = 400;

/**
 * Разбор свободного текста в запись.
 *
 * Сервер только понимает сообщение и возвращает структуру — саму запись
 * создаёт приложение через обычный стор. Так разбор остаётся одной
 * дополнительной возможностью, а не отдельным путём записи данных
 * в обход local-first.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { user } = await requireUser(request);

		// Разбор дешевле распознавания на порядки, но всё же стоит денег.
		const limit = await checkRateLimit(`assistant:${user.id}`, 30, 60_000);
		if (!limit.allowed) {
			return apiError('RATE_LIMITED', 'Слишком часто. Подождите немного', 429);
		}

		const body = await request.json().catch(() => null);
		const text = typeof body?.text === 'string' ? body.text.trim() : '';

		if (!text) return apiError('INVALID_REQUEST', 'Пустое сообщение', 400);

		const intent = await resolveIntentProvider().parseIntent(text.slice(0, MAX_TEXT_LENGTH));

		return json({ intent });
	} catch (error) {
		if (error instanceof AuthError) return apiError(error.code, error.message, error.status);

		if (error instanceof AiError) {
			logServerError(`assistant/parse:${error.code}`, error.cause ?? error);
			return apiError(error.code, error.message, error.status);
		}

		logServerError('assistant/parse', error);
		return apiError('INTERNAL', 'Не удалось разобрать сообщение', 500);
	}
};
