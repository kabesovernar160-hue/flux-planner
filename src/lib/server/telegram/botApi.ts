import { env } from '$env/dynamic/private';

const API_BASE = 'https://api.telegram.org';

/**
 * Клиент Bot API.
 *
 * Только серверный. Токен бота даёт полный контроль над ботом, и любой его
 * вызов из браузера означал бы, что токен уехал в бандл.
 */

export class BotApiError extends Error {
	constructor(
		readonly method: string,
		readonly status: number,
		readonly description: string
	) {
		super(`${method}: ${description}`);
		this.name = 'BotApiError';
	}
}

function requireToken(): string {
	const token = env.TELEGRAM_BOT_TOKEN?.trim();
	if (!token) throw new BotApiError('config', 500, 'TELEGRAM_BOT_TOKEN не задан');
	return token;
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
	const response = await fetch(`${API_BASE}/bot${requireToken()}/${method}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
		// Ответ бота не должен подвешивать обработчик вебхука: Telegram сам
		// повторит доставку, если мы не ответим вовремя.
		signal: AbortSignal.timeout(15_000)
	});

	const data = (await response.json().catch(() => null)) as {
		ok: boolean;
		result?: T;
		description?: string;
	} | null;

	if (!response.ok || !data?.ok) {
		throw new BotApiError(method, response.status, data?.description ?? 'Неизвестная ошибка');
	}

	return data.result as T;
}

export interface SendMessageOptions {
	parseMode?: 'HTML' | 'MarkdownV2';
	disableNotification?: boolean;
	replyMarkup?: unknown;
}

export async function sendMessage(
	chatId: number | string,
	text: string,
	options: SendMessageOptions = {}
): Promise<void> {
	await call('sendMessage', {
		chat_id: chatId,
		text,
		parse_mode: options.parseMode,
		disable_notification: options.disableNotification,
		reply_markup: options.replyMarkup
	});
}

export interface InvoiceInput {
	title: string;
	description: string;
	/** Полезная нагрузка: возвращается в successful_payment и опознаёт заказ. */
	payload: string;
	/** Цена в звёздах Telegram. */
	stars: number;
	label: string;
	/**
	 * Период автопродления в секундах.
	 *
	 * Telegram Stars принимают ровно 30 дней. Без этого поля получится
	 * разовый платёж, а не подписка.
	 */
	subscriptionPeriod?: number;
}

/**
 * Ссылка на счёт в звёздах Telegram.
 *
 * Валюта XTR — это и есть звёзды; для неё не нужен платёжный провайдер
 * и provider_token, деньги обрабатывает сам Telegram. Ссылку открывает
 * Mini App через openInvoice — внешний браузер для оплаты не нужен.
 */
export async function createInvoiceLink(input: InvoiceInput): Promise<string> {
	return call<string>('createInvoiceLink', {
		title: input.title,
		description: input.description,
		payload: input.payload,
		currency: 'XTR',
		prices: [{ label: input.label, amount: input.stars }],
		subscription_period: input.subscriptionPeriod
	});
}

/**
 * Подтверждение счёта перед списанием.
 *
 * Telegram ждёт ответа не дольше десяти секунд, иначе платёж отменяется.
 * Поэтому здесь не должно быть тяжёлой работы — только быстрая проверка.
 */
export async function answerPreCheckoutQuery(
	preCheckoutQueryId: string,
	ok: boolean,
	errorMessage?: string
): Promise<void> {
	await call('answerPreCheckoutQuery', {
		pre_checkout_query_id: preCheckoutQueryId,
		ok,
		error_message: ok ? undefined : errorMessage
	});
}

/**
 * Возврат звёзд.
 *
 * Возвращает всю сумму платежа: частичных возвратов у звёзд нет.
 * Вызывается вручную из поддержки — автоматического возврата в продукте нет.
 */
export async function refundStarPayment(
	telegramUserId: number | string,
	chargeId: string
): Promise<void> {
	await call('refundStarPayment', {
		user_id: Number(telegramUserId),
		telegram_payment_charge_id: chargeId
	});
}

/**
 * Ответ на нажатие инлайн-кнопки.
 *
 * Отправить его обязательно: пока ответа нет, клиент держит на кнопке
 * крутящийся индикатор, и пользователю кажется, что бот завис.
 */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
	await call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

/**
 * Снятие клавиатуры с уже отправленного сообщения.
 *
 * После подтверждения кнопки убираются: иначе «Записать» остаётся нажимаемой,
 * и человек вправе ожидать, что второе нажатие что-то сделает.
 */
export async function editMessageReplyMarkup(
	chatId: number | string,
	messageId: number,
	replyMarkup?: unknown
): Promise<void> {
	await call('editMessageReplyMarkup', {
		chat_id: chatId,
		message_id: messageId,
		reply_markup: replyMarkup ?? { inline_keyboard: [] }
	});
}

/**
 * Путь к файлу на серверах Telegram.
 *
 * Ссылка живёт около часа и содержит токен бота, поэтому наружу
 * её отдавать нельзя — скачиваем сами.
 */
export async function getFilePath(fileId: string): Promise<string> {
	const file = await call<{ file_path?: string }>('getFile', { file_id: fileId });
	if (!file.file_path) throw new BotApiError('getFile', 404, 'Файл недоступен');
	return file.file_path;
}

export async function downloadFile(filePath: string, maxBytes: number): Promise<Uint8Array> {
	const response = await fetch(`${API_BASE}/file/bot${requireToken()}/${filePath}`, {
		signal: AbortSignal.timeout(20_000)
	});

	if (!response.ok) {
		throw new BotApiError('downloadFile', response.status, 'Не удалось скачать файл');
	}

	// Заголовок длины может отсутствовать или врать, поэтому размер
	// проверяется и до чтения, и после.
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new BotApiError('downloadFile', 413, 'Файл слишком большой');
	}

	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.length > maxBytes) {
		throw new BotApiError('downloadFile', 413, 'Файл слишком большой');
	}

	return bytes;
}

/** Регистрация вебхука. Вызывается вручную при развёртывании. */
export async function setWebhook(url: string, secretToken: string): Promise<void> {
	await call('setWebhook', {
		url,
		secret_token: secretToken,
		// pre_checkout_query обязателен для платежей: без него Telegram
		// не дождётся подтверждения и отменит списание.
		allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
		drop_pending_updates: true
	});
}
