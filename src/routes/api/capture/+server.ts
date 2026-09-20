import { json } from '@sveltejs/kit';
import { resolveIntentProvider } from '$lib/server/ai/intentProvider';
import { applyIntent, describeApplied } from '$lib/server/assistant/applyIntent';
import { findUserByCaptureToken } from '$lib/server/capture/tokens';
import { getReadyDb } from '$lib/server/db/client';
import { createRepositories } from '$lib/server/db/repositories';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import { parseWeightMessage } from '$lib/utils/weight';
import { getToday, nowIso } from '$lib/utils/date';
import { createId } from '$lib/utils/id';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Запись одной строкой, без Telegram.
 *
 * Сюда стучится «Быстрая команда» с телефона: кнопка «Действие», двойное
 * касание крышки, ярлык на экране блокировки, Siri. Человек говорит
 * «ужин в 19:00» — и запись появляется в дневнике, не открывая ни чат,
 * ни приложение. Это и есть главный сценарий быстрого ввода: чем меньше
 * шагов между мыслью и записью, тем выше шанс, что дневник доживёт
 * до второй недели.
 *
 * Авторизация — личным ключом, а не подписью Telegram: Mini App в этот
 * момент не запущен, и подписи взять негде. Ключ умеет ровно одно —
 * записать строку.
 */

/** Полминуты на запрос: разбор может уйти к модели, но не дольше. */
const MAX_TEXT_LENGTH = 400;

/**
 * Потолок частоты.
 *
 * Тридцать записей в минуту — заведомо больше, чем успевает надиктовать
 * человек, и заведомо меньше, чем нужно, чтобы утёкшим ключом засыпать
 * дневник мусором незаметно.
 */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function readToken(request: Request, url: URL): string {
	const header = request.headers.get('authorization') ?? '';
	const bearer = header.replace(/^Bearer\s+/i, '').trim();
	if (bearer) return bearer;

	// Некоторые клиенты не дают задать заголовок — тогда ключ идёт
	// параметром. Это хуже (адрес виден в журналах), но лучше, чем
	// невозможность записать.
	return url.searchParams.get('key')?.trim() ?? '';
}

/**
 * Текст запроса.
 *
 * Принимается и JSON, и просто строка: в «Быстрых командах» отправить
 * надиктованный текст телом проще всего, а требовать от человека собирать
 * JSON руками — значит не получить ни одной записи.
 */
async function readText(request: Request): Promise<string> {
	const type = request.headers.get('content-type') ?? '';
	const body = await request.text();

	if (!body) return '';

	if (type.includes('application/json')) {
		try {
			const parsed = JSON.parse(body) as { text?: unknown };
			return typeof parsed.text === 'string' ? parsed.text : '';
		} catch {
			// Неразобранный JSON — это, скорее всего, просто текст.
			return body;
		}
	}

	return body;
}

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	const anonymous = await checkRateLimit(`capture:ip:${getClientAddress()}`, 60, RATE_WINDOW_MS);
	if (!anonymous.allowed) {
		return apiError('RATE_LIMITED', 'Слишком много запросов', 429);
	}

	try {
		const token = readToken(request, url);
		if (!token) return apiError('UNAUTHENTICATED', 'Нужен ключ быстрой записи', 401);

		const db = await getReadyDb();
		const user = await findUserByCaptureToken(db, token);
		if (!user) return apiError('UNAUTHENTICATED', 'Ключ не подходит или отозван', 401);

		const limit = await checkRateLimit(`capture:user:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
		if (!limit.allowed) {
			return apiError('RATE_LIMITED', 'Слишком часто. Подождите минуту', 429);
		}

		const text = (await readText(request)).trim().slice(0, MAX_TEXT_LENGTH);
		if (!text) return apiError('EMPTY', 'Нечего записывать', 400);

		const repositories = createRepositories(db);

		// Вес разбирается до общего разбора: «вес 78» иначе стало бы едой
		// на 78 килокалорий.
		const weightKg = parseWeightMessage(text);
		if (weightKg !== null) {
			const timestamp = nowIso();

			await repositories.weight.upsertMany(user.id, [
				{
					id: createId(),
					createdAt: timestamp,
					updatedAt: timestamp,
					deletedAt: null,
					date: getToday(user.timezone),
					weightKg
				} as never
			]);

			return json({ ok: true, message: `Записал вес: ${weightKg} кг` });
		}

		const intent = await resolveIntentProvider().parseIntent(text);
		const applied = await applyIntent(intent, {
			repositories,
			userId: user.id,
			timezone: user.timezone
		});

		if (!applied) {
			// Честный отказ вместо выдуманной записи: человек увидит его
			// прямо в уведомлении команды и переформулирует.
			return json(
				{ ok: false, message: 'Не понял, что записать. Попробуйте «ужин в 19:00»' },
				{ status: 422 }
			);
		}

		return json({ ok: true, message: `Записал. ${describeApplied(applied)}` });
	} catch (error) {
		logServerError('capture', error);
		return apiError('INTERNAL', 'Не удалось записать', 500);
	}
};
