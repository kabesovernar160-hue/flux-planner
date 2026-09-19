/**
 * Запуск бота локально: long polling вместо вебхука.
 *
 * Скрипт не содержит логики бота — он только транспорт. Обновления
 * забираются у Telegram методом getUpdates и переотправляются в тот же
 * эндпоинт /api/telegram/webhook, который работает в продакшене. Поэтому
 * поведение бота на ноутбуке и на сервере одинаковое: код обработки один
 * и тот же, отличается только способ доставки.
 *
 * Зачем это нужно: вебхук требует публичного HTTPS-адреса, которого у машины
 * разработчика обычно нет. Поллинг снимает это требование для самого бота
 * (адрес Mini App всё равно должен быть публичным — его открывает Telegram).
 *
 * Запуск:
 *   npm run bot
 *
 * Требуются переменные окружения TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET,
 * а также запущенное приложение (npm run dev).
 */

const API_BASE = 'https://api.telegram.org';

/** Сколько Telegram держит запрос getUpdates, пока нет новых событий. */
const POLL_TIMEOUT_SECONDS = 30;

/** Пауза после сетевой ошибки, чтобы не молотить запросами в пустоту. */
const RETRY_DELAY_MS = 3_000;

function loadEnvFile(): void {
	try {
		// Node 20.12+. Отсутствие .env — нормальная ситуация: переменные
		// могут приходить из окружения процесса.
		process.loadEnvFile?.('.env');
	} catch {
		/* файла нет — работаем с тем, что уже в окружении */
	}
}

function required(name: string): string {
	const value = process.env[name]?.trim();

	if (!value) {
		console.error(`[bot] Не задана переменная ${name}. Скопируйте .env.example в .env.`);
		process.exit(1);
	}

	return value;
}

interface TelegramUpdate {
	update_id: number;
}

async function callBotApi<T>(token: string, method: string, payload: unknown): Promise<T> {
	const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
		// Ответ на getUpdates ждём дольше самого long polling: иначе запрос
		// обрывался бы ровно тогда, когда Telegram ещё держит соединение.
		signal: AbortSignal.timeout((POLL_TIMEOUT_SECONDS + 15) * 1000)
	});

	const data = (await response.json().catch(() => null)) as {
		ok?: boolean;
		result?: T;
		description?: string;
	} | null;

	if (!response.ok || !data?.ok) {
		throw new Error(`${method}: ${data?.description ?? response.status}`);
	}

	return data.result as T;
}

async function deliver(update: TelegramUpdate, webhookUrl: string, secret: string): Promise<void> {
	const response = await fetch(webhookUrl, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			// Тот же секрет, что присылает Telegram при работе через вебхук:
			// эндпоинт не делает исключений для локального запуска.
			'x-telegram-bot-api-secret-token': secret
		},
		body: JSON.stringify(update),
		signal: AbortSignal.timeout(90_000)
	});

	if (!response.ok) {
		throw new Error(`webhook ответил ${response.status}`);
	}
}

async function main(): Promise<void> {
	loadEnvFile();

	const token = required('TELEGRAM_BOT_TOKEN');
	const secret = required('TELEGRAM_WEBHOOK_SECRET');
	const appUrl = (process.env.APP_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '');
	const webhookUrl = `${appUrl}/api/telegram/webhook`;

	// Вебхук и поллинг взаимоисключающи: пока зарегистрирован вебхук,
	// getUpdates отвечает ошибкой.
	await callBotApi(token, 'deleteWebhook', { drop_pending_updates: false });

	const me = await callBotApi<{ username?: string }>(token, 'getMe', {});
	console.log(`[bot] @${me.username ?? 'бот'} слушает обновления`);
	console.log(`[bot] обновления уходят в ${webhookUrl}`);

	if (!process.env.TELEGRAM_MINI_APP_URL?.trim()) {
		console.warn('[bot] TELEGRAM_MINI_APP_URL не задан — кнопка открытия приложения не появится');
	}

	let offset = 0;
	let running = true;

	const stop = () => {
		running = false;
		console.log('\n[bot] остановлен');
		process.exit(0);
	};

	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);

	while (running) {
		try {
			const updates = await callBotApi<TelegramUpdate[]>(token, 'getUpdates', {
				offset,
				timeout: POLL_TIMEOUT_SECONDS,
				allowed_updates: ['message', 'callback_query', 'pre_checkout_query']
			});

			for (const update of updates) {
				// Сдвигаем offset до обработки: иначе обновление, на котором
				// приложение упало, будет приходить снова и снова.
				offset = update.update_id + 1;

				try {
					await deliver(update, webhookUrl, secret);
				} catch (error) {
					console.error('[bot] обновление не доставлено:', (error as Error).message);
				}
			}
		} catch (error) {
			console.error('[bot] ошибка опроса:', (error as Error).message);
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		}
	}
}

main().catch((error: unknown) => {
	console.error('[bot]', error);
	process.exit(1);
});
