import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runFoodScan } from '$lib/server/ai';
import { MAX_IMAGE_BYTES, sniffMediaType } from '$lib/server/ai/image';
import { AiError } from '$lib/server/ai/types';
import { getReadyDb } from '$lib/server/db/client';
import { createRepositories, type Repositories } from '$lib/server/db/repositories';
import { logServerError } from '$lib/server/errors';
import {
	answerCallbackQuery,
	answerPreCheckoutQuery,
	downloadFile,
	editMessageReplyMarkup,
	getFilePath,
	sendMessage
} from '$lib/server/telegram/botApi';
import { activateSubscription, revokeSubscription } from '$lib/server/billing/subscriptions';
import { resolveIntentProvider } from '$lib/server/ai/intentProvider';
import {
	applyIntent,
	markPlanDone,
	planFallbackIntent,
	undoApplied,
	type AppliedRecord
} from '$lib/server/assistant/applyIntent';
import { PLANS } from '$lib/billing/plans';
import {
	APP_URL_MISSING_TEXT,
	confirmScanKeyboard,
	formatSavedMessage,
	formatScanMessage,
	HELP_TEXT,
	isValidMiniAppUrl,
	miniAppKeyboard,
	NO_FOOD_TEXT,
	WELCOME_TEXT
} from '$lib/server/telegram/botMessages';
import type { FoodScanResult } from '$lib/types/nutrition';
import { getToday, nowIso } from '$lib/utils/date';
import { formatWeight } from '$lib/utils/format';
import { mealForTime } from '$lib/utils/meals';
import { isWeightInRange, MAX_WEIGHT_KG, MIN_WEIGHT_KG, roundWeight } from '$lib/utils/weight';
import { createId } from '$lib/utils/id';
import type { RequestHandler } from './$types';

export const prerender = false;

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Сколько живёт неподтверждённый разбор.
 *
 * Полчаса: дольше держать смысла нет — человек либо подтвердил сразу, либо
 * уже забыл, о каком снимке речь, и подтверждать вслепую ему нечего.
 */
const PENDING_TTL_MS = 30 * 60 * 1000;

interface TelegramMessage {
	message_id?: number;
	chat?: { id?: number };
	from?: { id?: number; first_name?: string; username?: string };
	text?: string;
	caption?: string;
	photo?: { file_id?: string; file_size?: number; width?: number }[];
	successful_payment?: TelegramSuccessfulPayment;
	refunded_payment?: TelegramSuccessfulPayment;
}

interface TelegramSuccessfulPayment {
	currency?: string;
	total_amount?: number;
	invoice_payload?: string;
	telegram_payment_charge_id?: string;
	subscription_expiration_date?: number;
	is_recurring?: boolean;
	is_first_recurring?: boolean;
}

interface TelegramPreCheckoutQuery {
	id?: string;
	from?: { id?: number; first_name?: string; username?: string };
	currency?: string;
	total_amount?: number;
	invoice_payload?: string;
}

interface TelegramCallbackQuery {
	id?: string;
	data?: string;
	from?: { id?: number; first_name?: string; username?: string };
	message?: TelegramMessage;
}

/** Формат «450 борщ»: число калорий и название. */
const QUICK_ENTRY = /^\s*(\d+(?:[.,]\d+)?)\s+(.{1,80})\s*$/;

/**
 * Формат «вес 78,4».
 *
 * Разбирается правилом, а не моделью: взвешивание — короткая цифра, которую
 * человек шлёт каждое утро, и гонять ради неё запрос к ИИ значит платить
 * за то, что надёжнее делает регулярное выражение. Проверка должна стоять
 * раньше «450 борщ», иначе «вес 78» стал бы едой на 78 килокалорий.
 */
const WEIGHT_ENTRY = /^\s*вес[\s:]+(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:кг)?\s*$/i;

/** Команда с возможным суффиксом бота: /start@flux_planner_bot. */
function command(text: string): string {
	return text.split(/\s+/)[0].split('@')[0].toLowerCase();
}

function miniAppUrl(): string | undefined {
	return env.TELEGRAM_MINI_APP_URL?.trim() || undefined;
}

async function resolveUser(telegramUserId: string, from: TelegramMessage['from']) {
	const repositories = createRepositories(await getReadyDb());

	const user = await repositories.users.upsertFromTelegram({
		id: createId(),
		telegramUserId,
		username: from?.username,
		firstName: from?.first_name,
		now: nowIso()
	});

	return { userId: user.id, timezone: user.timezone, repositories };
}

/** Приветствие с кнопкой запуска Mini App — то, ради чего бот и существует. */
async function sendWelcome(chatId: number): Promise<void> {
	const url = miniAppUrl();

	if (!isValidMiniAppUrl(url)) {
		// Кнопку с неверным адресом Telegram не примет, а молчаливый ответ
		// без кнопки выглядит как поломка. Говорим прямо, чего не хватает.
		logServerError('telegram/webhook', new Error('TELEGRAM_MINI_APP_URL не задан или не https'));
		await sendMessage(chatId, APP_URL_MISSING_TEXT);
		return;
	}

	await sendMessage(chatId, WELCOME_TEXT, { replyMarkup: miniAppKeyboard(url) });
}

async function saveScan(
	repositories: Repositories,
	userId: string,
	timezone: string,
	result: FoodScanResult
): Promise<void> {
	const timestamp = nowIso();
	const date = getToday(timezone);
	// Приём пищи по времени в поясе человека: фотографируют еду обычно тогда,
	// когда её едят. Разложение по приёмам должно работать и для записей
	// из чата, иначе дневник у бота и у приложения выглядит по-разному.
	const meal = mealForTime(new Date(), timezone);

	// Каждый компонент — отдельная запись, как и в приложении: модель данных
	// у бота и у Mini App обязана быть одна, иначе дневник разъедется.
	await repositories.food.upsertMany(
		userId,
		result.items.map(
			(item) =>
				({
					id: createId(),
					createdAt: timestamp,
					updatedAt: timestamp,
					deletedAt: null,
					date,
					name: item.name,
					grams: item.estimatedGrams,
					calories: item.calories,
					protein: item.protein,
					fat: item.fat,
					carbs: item.carbs,
					source: 'ai',
					meal
				}) as never
		)
	);
}

async function handlePhoto(
	message: TelegramMessage,
	chatId: number,
	userId: string,
	repositories: Repositories
): Promise<void> {
	// Telegram присылает несколько размеров. Берём самый крупный,
	// который укладывается в предел: мелкий превью распознаётся хуже.
	const candidates = (message.photo ?? [])
		.filter((photo) => photo.file_id && (photo.file_size ?? 0) <= MAX_IMAGE_BYTES)
		.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));

	const photo = candidates[0];
	if (!photo?.file_id) {
		await sendMessage(chatId, 'Фото слишком большое. Пришлите снимок поменьше.');
		return;
	}

	const bytes = await downloadFile(await getFilePath(photo.file_id), MAX_IMAGE_BYTES);
	const mediaType = sniffMediaType(bytes);

	if (!mediaType) {
		await sendMessage(chatId, 'Не получилось прочитать изображение.');
		return;
	}

	let result: FoodScanResult;
	try {
		result = await runFoodScan({ bytes, mediaType });
	} catch (error) {
		if (error instanceof AiError) {
			logServerError(`telegram/webhook:${error.code}`, error.cause ?? error);
			await sendMessage(chatId, error.code === 'NO_FOOD_DETECTED' ? NO_FOOD_TEXT : error.message);
			return;
		}
		throw error;
	}

	// Результат не пишется в дневник сам: сначала человек его видит,
	// потом решает. Оценка по фотографии слишком приблизительна, чтобы
	// попадать в дневник без подтверждения.
	const scanId = createId();
	await repositories.pendingScans.save({ id: scanId, userId, payload: result, now: nowIso() });
	await repositories.pendingScans.purgeOlderThan(
		new Date(Date.now() - PENDING_TTL_MS).toISOString()
	);

	await sendMessage(chatId, formatScanMessage(result), {
		replyMarkup: confirmScanKeyboard(scanId, miniAppUrl())
	});
}

async function handleCallback(query: TelegramCallbackQuery): Promise<void> {
	const chatId = query.message?.chat?.id;
	const messageId = query.message?.message_id;
	const fromId = query.from?.id;
	const parts = (query.data ?? '').split(':');

	if (!query.id || !chatId || !fromId) return;

	if (parts[0] === 'done') {
		const [, , id] = parts;
		const { userId, timezone, repositories } = await resolveUser(String(fromId), query.from);

		await markPlanDone(id, { repositories, userId, timezone });
		await answerCallbackQuery(query.id, 'Отметил выполненным');
		if (messageId) await editMessageReplyMarkup(chatId, messageId);
		return;
	}

	if (parts[0] === 'undo') {
		const [, collection, id] = parts;

		if (collection === 'plan' || collection === 'food' || collection === 'finance') {
			const { userId, timezone, repositories } = await resolveUser(String(fromId), query.from);
			await undoApplied({ collection, id }, { repositories, userId, timezone });
		}

		await answerCallbackQuery(query.id, 'Отменил');
		if (messageId) await editMessageReplyMarkup(chatId, messageId);
		return;
	}

	if (parts[0] !== 'scan') {
		// Чужая или устаревшая кнопка. Ответить всё равно обязательно: пока
		// ответа нет, клиент крутит индикатор на кнопке.
		await answerCallbackQuery(query.id);
		return;
	}

	const [, action, scanId] = parts;
	const { userId, timezone, repositories } = await resolveUser(String(fromId), query.from);

	// Разбор забирается по паре «идентификатор + пользователь»: чужую запись
	// база не отдаст, даже если callback_data подсмотрели.
	const payload = (await repositories.pendingScans.take(scanId, userId)) as FoodScanResult | null;

	if (!payload) {
		await answerCallbackQuery(query.id, 'Этот разбор уже неактуален');
		if (messageId) await editMessageReplyMarkup(chatId, messageId);
		return;
	}

	if (action === 'drop') {
		await answerCallbackQuery(query.id, 'Отменил');
		if (messageId) await editMessageReplyMarkup(chatId, messageId);
		await sendMessage(chatId, 'Хорошо, ничего не записал.');
		return;
	}

	await saveScan(repositories, userId, timezone, payload);
	await answerCallbackQuery(query.id, 'Записал');
	if (messageId) await editMessageReplyMarkup(chatId, messageId);
	await sendMessage(chatId, formatSavedMessage(payload));
}

/**
 * Подтверждение счёта перед списанием.
 *
 * Telegram ждёт ответа не дольше десяти секунд — иначе платёж отменяется.
 * Поэтому здесь только быстрая проверка формы платежа, без обращений к базе:
 * всё существенное произойдёт после списания, в successful_payment.
 */
async function handlePreCheckout(query: TelegramPreCheckoutQuery): Promise<void> {
	if (!query.id) return;

	const payload = parsePaymentPayload(query.invoice_payload);
	const valid = payload !== null && query.currency === 'XTR';

	await answerPreCheckoutQuery(
		query.id,
		valid,
		valid ? undefined : 'Счёт устарел. Откройте приложение и попробуйте снова.'
	);
}

function parsePaymentPayload(raw: string | undefined): { userId: string; plan: string } | null {
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as { userId?: unknown; plan?: unknown };
		if (typeof parsed.userId !== 'string' || typeof parsed.plan !== 'string') return null;
		return { userId: parsed.userId, plan: parsed.plan };
	} catch {
		return null;
	}
}

/**
 * Состоявшийся платёж.
 *
 * Пользователь берётся из обновления Telegram, а не из payload: payload
 * пришёл от нас, но подпись под ним никто не ставил, и полагаться на него
 * как на удостоверение нельзя. Из него берём только тариф.
 */
async function handleSuccessfulPayment(
	message: TelegramMessage,
	chatId: number,
	fromId: number
): Promise<void> {
	const payment = message.successful_payment;
	const chargeId = payment?.telegram_payment_charge_id;

	if (!payment || !chargeId) return;

	const payload = parsePaymentPayload(payment.invoice_payload);
	const plan = payload?.plan === 'pro' ? 'pro' : 'pro';

	const { userId, repositories } = await resolveUser(String(fromId), message.from);

	// Срок из Telegram точнее: он привязан к самому списанию и учитывает
	// автопродление. Свой расчёт — запасной вариант.
	const expiresAt = payment.subscription_expiration_date
		? new Date(payment.subscription_expiration_date * 1000).toISOString()
		: null;

	const result = await activateSubscription(await getReadyDb(), {
		userId,
		plan,
		chargeId,
		stars: payment.total_amount ?? PLANS.pro.stars,
		payload: payment.invoice_payload ?? '',
		expiresAt
	});

	void repositories;

	// Повторную доставку того же обновления не подтверждаем второй раз:
	// человек не должен получать два сообщения об одной оплате.
	if (!result.applied) return;

	const until = new Date(result.expiresAt).toLocaleDateString('ru-RU', {
		day: 'numeric',
		month: 'long'
	});

	await sendMessage(
		chatId,
		[
			'Спасибо! Подписка Flux Planner Pro активна.',
			'',
			`Действует до ${until}, продлевается автоматически.`,
			`Распознаваний по фото: ${PLANS.pro.limits.scansPerDay} в день.`,
			'',
			'Отменить можно в настройках Telegram или написав сюда «отмена».'
		].join('\n'),
		{ replyMarkup: miniAppKeyboard(miniAppUrl()) }
	);
}

/**
 * Возврат звёзд.
 *
 * Telegram присылает его отдельным сообщением, когда деньги вернулись
 * пользователю. Доступ снимается сразу: оставлять оплаченные возможности
 * после возврата — прямой убыток.
 */
async function handleRefund(message: TelegramMessage, chatId: number): Promise<void> {
	const chargeId = message.refunded_payment?.telegram_payment_charge_id;
	if (!chargeId) return;

	const revoked = await revokeSubscription(await getReadyDb(), chargeId);
	if (!revoked) return;

	await sendMessage(chatId, 'Звёзды возвращены, подписка отключена. Бесплатный тариф остался.');
}

/** Как записанное выглядит в ответе бота. */
function describeApplied(record: AppliedRecord): string {
	const when =
		record.date === getToday() ? 'сегодня' : record.date.split('-').reverse().slice(0, 2).join('.');

	switch (record.kind) {
		case 'plan':
			return `В план на ${when}: ${record.title}${record.time ? ` в ${record.time}` : ''}`;
		case 'food':
			return `В дневник питания: ${record.title}${
				record.calories
					? `, ${Math.round(record.calories)} ккал`
					: ' (калории поправьте в приложении)'
			}`;
		case 'expense':
			return `Трата: ${record.title}${record.amount ? `, ${Math.round(record.amount)} ₽` : ''}`;
		case 'income':
			return `Доход: ${record.title}${record.amount ? `, ${Math.round(record.amount)} ₽` : ''}`;
	}
}

/**
 * Свободный текст.
 *
 * Сообщение разбирается и сразу записывается — с кнопкой отмены. Спрашивать
 * подтверждение до записи здесь не нужно: формулировку придумал человек,
 * а не модель, и лишний вопрос на каждое «ужин в 19:00» раздражал бы.
 * Разбор всё же может ошибиться, поэтому отмена всегда под рукой.
 */
async function handleFreeText(
	text: string,
	chatId: number,
	userId: string,
	timezone: string,
	repositories: Repositories
): Promise<void> {
	const intent = await resolveIntentProvider().parseIntent(text);
	let applied = await applyIntent(intent, { repositories, userId, timezone });

	if (!applied) {
		// Разбор не понял сообщение. Если оно похоже на дело, всё равно
		// записываем в план: человек ждёт запись, а не справку.
		const fallback = planFallbackIntent(text);
		if (fallback) applied = await applyIntent(fallback, { repositories, userId, timezone });
	}

	if (!applied) {
		await sendMessage(chatId, HELP_TEXT, { replyMarkup: miniAppKeyboard(miniAppUrl()) });
		return;
	}

	// У пункта плана есть ещё одно осмысленное действие прямо из чата:
	// отметить выполненным, не открывая приложение.
	const buttons = [
		{ text: '✖️ Отменить', callback_data: `undo:${applied.collection}:${applied.id}` }
	];
	if (applied.kind === 'plan') {
		buttons.unshift({ text: '✅ Готово', callback_data: `done:plan:${applied.id}` });
	}

	await sendMessage(chatId, `Записал. ${describeApplied(applied)}`, {
		replyMarkup: { inline_keyboard: [buttons] }
	});
}

/**
 * Запись веса из чата.
 *
 * Одна запись на день, как и в приложении: повторное сообщение заменяет
 * значение, а не добавляет второе. Слияние по дню делает сервер, поэтому
 * идентификатор здесь случайный.
 */
async function saveWeight(
	repositories: Repositories,
	userId: string,
	timezone: string,
	weightKg: number,
	chatId: number
): Promise<void> {
	if (!isWeightInRange(weightKg)) {
		await sendMessage(chatId, `Вес должен быть между ${MIN_WEIGHT_KG} и ${MAX_WEIGHT_KG} кг.`);
		return;
	}

	const timestamp = nowIso();
	const rounded = roundWeight(weightKg);

	await repositories.weight.upsertMany(userId, [
		{
			id: createId(),
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			date: getToday(timezone),
			weightKg: rounded
		} as never
	]);

	await sendMessage(chatId, `Записал вес: ${formatWeight(rounded)} кг.`);
}

async function handleMessage(message: TelegramMessage, chatId: number, fromId: number) {
	// Платежи приходят обычными сообщениями и должны обрабатываться
	// до разбора текста: у них его просто нет.
	if (message.successful_payment) {
		await handleSuccessfulPayment(message, chatId, fromId);
		return;
	}

	if (message.refunded_payment) {
		await handleRefund(message, chatId);
		return;
	}

	const text = (message.text ?? message.caption ?? '').trim();
	const name = command(text);

	// Приветствие не требует ни базы, ни распознавания: отвечаем сразу.
	if (name === '/start' || name === '/app') {
		await sendWelcome(chatId);
		return;
	}

	if (name === '/help') {
		await sendMessage(chatId, HELP_TEXT, { replyMarkup: miniAppKeyboard(miniAppUrl()) });
		return;
	}

	const { userId, timezone, repositories } = await resolveUser(String(fromId), message.from);

	if (message.photo?.length) {
		await handlePhoto(message, chatId, userId, repositories);
		return;
	}

	const weight = WEIGHT_ENTRY.exec(text);
	if (weight) {
		await saveWeight(repositories, userId, timezone, Number(weight[1].replace(',', '.')), chatId);
		return;
	}

	const quick = QUICK_ENTRY.exec(text);
	if (quick) {
		const calories = Number(quick[1].replace(',', '.'));
		const title = quick[2].trim();

		if (!Number.isFinite(calories) || calories <= 0 || calories > 20_000) {
			await sendMessage(chatId, 'Похоже на опечатку в калориях. Попробуйте ещё раз.');
			return;
		}

		// Числа названы человеком, а не моделью: подтверждать нечего,
		// записываем сразу. Макросы из текста не вытащить — пишем нули.
		const timestamp = nowIso();
		await repositories.food.upsertMany(userId, [
			{
				id: createId(),
				createdAt: timestamp,
				updatedAt: timestamp,
				deletedAt: null,
				date: getToday(timezone),
				name: title,
				calories,
				protein: 0,
				fat: 0,
				carbs: 0,
				source: 'manual',
				meal: mealForTime(new Date(), timezone)
			} as never
		]);

		await sendMessage(chatId, `Записал: ${title}, ${Math.round(calories)} ккал.`);
		return;
	}

	if (text.length > 0) {
		await handleFreeText(text, chatId, userId, timezone, repositories);
		return;
	}

	await sendMessage(chatId, HELP_TEXT, { replyMarkup: miniAppKeyboard(miniAppUrl()) });
}

export const POST: RequestHandler = async ({ request }) => {
	// Вебхук открыт наружу, поэтому Telegram подписывает его секретом.
	// Без проверки любой желающий писал бы записи в чужие дневники.
	const expected = env.TELEGRAM_WEBHOOK_SECRET?.trim();
	if (!expected || request.headers.get(SECRET_HEADER) !== expected) {
		return json({ ok: false }, { status: 401 });
	}

	let update: {
		message?: TelegramMessage;
		callback_query?: TelegramCallbackQuery;
		pre_checkout_query?: TelegramPreCheckoutQuery;
	};
	try {
		update = await request.json();
	} catch {
		return json({ ok: true });
	}

	// Telegram считает доставленным любой ответ 200. Отвечаем так всегда,
	// иначе он будет повторять одно и то же обновление по кругу.
	try {
		if (update.pre_checkout_query) {
			await handlePreCheckout(update.pre_checkout_query);
			return json({ ok: true });
		}

		if (update.callback_query) {
			await handleCallback(update.callback_query);
			return json({ ok: true });
		}

		const message = update.message;
		const chatId = message?.chat?.id;
		const fromId = message?.from?.id;
		if (!message || !chatId || !fromId) return json({ ok: true });

		await handleMessage(message, chatId, fromId);
		return json({ ok: true });
	} catch (error) {
		logServerError('telegram/webhook', error);

		const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;

		// Пользователю — короткое сообщение, Telegram — успех, чтобы он
		// не крутил повтор доставки на сломанном обновлении.
		try {
			if (chatId)
				await sendMessage(chatId, 'Не получилось обработать сообщение. Попробуйте ещё раз.');
		} catch {
			/* бот мог быть заблокирован — это не наша проблема */
		}

		return json({ ok: true });
	}
};
