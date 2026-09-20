import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { resolveIntentProvider } from '$lib/server/ai/intentProvider';
import { applyIntent, describeApplied } from '$lib/server/assistant/applyIntent';
import { findUserByCaptureToken } from '$lib/server/capture/tokens';
import { getReadyDb } from '$lib/server/db/client';
import { createRepositories } from '$lib/server/db/repositories';
import { sendMessage } from '$lib/server/telegram/botApi';
import { miniAppKeyboard } from '$lib/server/telegram/botMessages';
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

/**
 * Эхо записи в чат с ботом.
 *
 * Надиктованное телефоном не видно нигде, пока человек не откроет приложение,
 * — а распознавание речи ошибается: «полтора» становится «пол-литра», «такси»
 * — «такты». Поэтому в чат уходит и то, что записано, и то, что услышано:
 * чат оказывается лентой быстрых записей, по которой видно, что произошло,
 * и откуда одной кнопкой открывается приложение.
 *
 * Молчаливо и необязательно: не ушло сообщение — запись всё равно сделана,
 * и подтверждение человек уже увидел в уведомлении команды.
 */
async function echoToChat(telegramUserId: string, recorded: string, heard: string): Promise<void> {
	try {
		await sendMessage(telegramUserId, `${recorded}\n\nУслышал: «${heard}»`, {
			replyMarkup: miniAppKeyboard(env.TELEGRAM_MINI_APP_URL?.trim() || undefined)
		});
	} catch (error) {
		logServerError('capture/echo', error);
	}
}

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
 * Принимается и JSON, и просто строка — но дойти сюда строкой может не всякий
 * клиент. SvelteKit отбивает POST с телом text/plain, form-urlencoded
 * и multipart как межсайтовый, если Origin не совпал, и делает это до
 * обработчика: «Быстрая команда» с телом «Текст» получает 403 и никогда
 * не доходит до разбора. Поэтому в инструкции тело — JSON с полем text,
 * а разбор строки остаётся для своих клиентов и проверок.
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
		if (!token) {
			// Подсказка с именем заголовка не роскошь: в «Быстрых командах»
			// имя и значение стоят рядом двумя полями, и их регулярно
			// заполняют наоборот — ключ в имя, слово Authorization в значение.
			return apiError(
				'UNAUTHENTICATED',
				'Нужен ключ: заголовок Authorization со значением «Bearer ключ»',
				401
			);
		}

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

			const recordedWeight = `Записал вес: ${weightKg} кг`;
			await echoToChat(user.telegramUserId, recordedWeight, text);

			return json({ ok: true, message: recordedWeight });
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

		const recorded = `Записал. ${describeApplied(applied)}`;
		await echoToChat(user.telegramUserId, recorded, text);

		return json({ ok: true, message: recorded });
	} catch (error) {
		logServerError('capture', error);
		return apiError('INTERNAL', 'Не удалось записать', 500);
	}
};
