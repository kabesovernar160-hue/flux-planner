/**
 * Регистрация вебхука бота — для развёртывания на сервере.
 *
 * На проде поллинг не нужен: приложение и так доступно по публичному HTTPS,
 * и Telegram может доставлять обновления напрямую. Скрипт делает ровно один
 * вызов setWebhook с секретом, который проверяет эндпоинт.
 *
 * Запуск:
 *   npm run bot:webhook
 *
 * Требуются TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и APP_URL —
 * публичный адрес приложения по HTTPS.
 */

const API_BASE = 'https://api.telegram.org';

function required(name: string): string {
	const value = process.env[name]?.trim();

	if (!value) {
		console.error(`[webhook] Не задана переменная ${name}.`);
		process.exit(1);
	}

	return value;
}

async function main(): Promise<void> {
	try {
		process.loadEnvFile?.('.env');
	} catch {
		/* переменные могут приходить из окружения процесса */
	}

	const token = required('TELEGRAM_BOT_TOKEN');
	const secret = required('TELEGRAM_WEBHOOK_SECRET');
	const appUrl = required('APP_URL').replace(/\/+$/, '');

	if (new URL(appUrl).protocol !== 'https:') {
		// Telegram доставляет обновления только по HTTPS, и отказ придёт
		// уже от API — понятнее сказать об этом сразу.
		console.error('[webhook] APP_URL должен начинаться с https://');
		process.exit(1);
	}

	const url = `${appUrl}/api/telegram/webhook`;

	const response = await fetch(`${API_BASE}/bot${token}/setWebhook`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			url,
			secret_token: secret,
			allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
			drop_pending_updates: true
		}),
		signal: AbortSignal.timeout(20_000)
	});

	const data = (await response.json().catch(() => null)) as {
		ok?: boolean;
		description?: string;
	} | null;

	if (!response.ok || !data?.ok) {
		console.error(`[webhook] не удалось: ${data?.description ?? response.status}`);
		process.exit(1);
	}

	console.log(`[webhook] зарегистрирован: ${url}`);
}

main().catch((error: unknown) => {
	console.error('[webhook]', error);
	process.exit(1);
});
