/**
 * Рассылка всем пользователям бота.
 *
 * По умолчанию ничего не отправляет: показывает текст и число получателей.
 * Сообщение уходит от имени бота с кнопкой открытия Mini App.
 *
 * Посмотреть:
 *   node scripts/broadcast.ts
 *
 * Прислать только себе, проверить, как выглядит:
 *   node scripts/broadcast.ts --test 1145673466
 *
 * Разослать всем:
 *   node scripts/broadcast.ts --confirm
 *
 * Свой текст вместо встроенного:
 *   node scripts/broadcast.ts --text-file message.txt
 *
 * База берётся из DATABASE_URL, а если он пуст — из TARGET_DATABASE_URL.
 * Удалённые учётные записи (telegram id вида deleted:…) пропускаются.
 */

import { readFileSync } from 'node:fs';
import { createClient, type Client } from '@libsql/client';

const DEFAULT_TEXT = [
	'Привет! Это Flux Planner — тот самый бот, про который ты, возможно, уже забыл 🙃',
	'',
	'Он не обиделся. Ну, почти. Зато научился новому:',
	'',
	'📸 Кинь фото тарелки — посчитаю калории. Да, шаурму тоже.',
	'💬 Напиши «450 борщ» или «1,5к на такси» — запишу сам.',
	'⚖️ «вес 78,4» — и график поползёт вниз (мы в тебя верим).',
	'💧 Вода, привычки, траты — всё на одном экране.',
	'',
	'Минута в день — и к вечеру понятно, куда делись калории и деньги.',
	'Спойлер: в шаурму.',
	'',
	'Жми кнопку, погнали 👇'
].join('\n');

const BUTTON_TEXT = '🚀 Открыть Flux Planner';
const PRODUCTION_APP_URL ='https://flux-planner-ten.vercel.app';

/** Telegram пускает около 30 сообщений в секунду; держимся с запасом. */
const DELAY_MS = 60;

function env(name: string): string {
	return process.env[name]?.trim() ?? '';
}

let open: Client | null = null;

/** Остановка с понятной причиной: process.exit роняет драйвер поверх сообщения. */
class Stop extends Error {}

function fail(message: string): never {
	throw new Stop(message);
}

function connect(): { client: Client; url: string } {
	const url = env('DATABASE_URL') || env('TARGET_DATABASE_URL');
	if (!url) fail('Не задан ни DATABASE_URL, ни TARGET_DATABASE_URL.');

	const authToken = env('DATABASE_URL')
		? env('DATABASE_AUTH_TOKEN')
		: env('TARGET_DATABASE_AUTH_TOKEN');

	const normalized = url.startsWith('file:') || url.includes('://') ? url : `file:${url}`;

	open = normalized.startsWith('file:')
		? createClient({ url: normalized })
		: createClient({ url: normalized, authToken: authToken || undefined });

	return { client: open, url: normalized };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SendResult = 'sent' | 'blocked' | 'failed';

async function send(token: string, chatId: string, text: string, appUrl: string): Promise<SendResult> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				reply_markup: { inline_keyboard: [[{ text: BUTTON_TEXT, web_app: { url: appUrl } }]] }
			}),
			signal: AbortSignal.timeout(15_000)
		});

		const data = (await response.json().catch(() => null)) as {
			ok: boolean;
			description?: string;
			parameters?: { retry_after?: number };
		} | null;

		if (data?.ok) return 'sent';

		// Слишком часто — Telegram сам говорит, сколько подождать.
		if (response.status === 429) {
			await sleep((data?.parameters?.retry_after ?? 1) * 1000 + 200);
			continue;
		}

		// Заблокировал бота или ни разу не нажимал «Начать»: писать ему нельзя.
		if (response.status === 403) return 'blocked';

		console.log(`[рассылка] ${chatId}: ${data?.description ?? response.status}`);
		return 'failed';
	}

	return 'failed';
}

async function main(): Promise<void> {
	for (const file of ['.env', '.env.local']) {
		try {
			process.loadEnvFile?.(file);
		} catch {
			/* переменные могут приходить из окружения процесса */
		}
	}

	const args = process.argv.slice(2);
	const confirm = args.includes('--confirm');
	const testIndex = args.indexOf('--test');
	const testId = testIndex >= 0 ? args[testIndex + 1] : undefined;
	const textIndex = args.indexOf('--text-file');
	const text =
		textIndex >= 0 ? readFileSync(args[textIndex + 1], 'utf8').trim() : DEFAULT_TEXT;

	if (testIndex >= 0 && !testId) fail('После --test нужен telegram id.');

	const token = env('TELEGRAM_BOT_TOKEN');
	if (!token) fail('Не задан TELEGRAM_BOT_TOKEN.');

	// Не TELEGRAM_MINI_APP_URL: локально там адрес туннеля, который умрёт
	// раньше, чем люди нажмут кнопку.
	const appUrlIndex = args.indexOf('--app-url');
	const appUrl = (appUrlIndex >= 0 ? args[appUrlIndex + 1] : '') || PRODUCTION_APP_URL;
	if (!appUrl.startsWith('https://')) fail(`Адрес приложения должен быть HTTPS: ${appUrl}`);

	console.log('[рассылка] текст:\n');
	console.log(text);
	console.log(`\n[рассылка] кнопка: ${BUTTON_TEXT} → ${appUrl}`);

	if (testId) {
		const result = await send(token, testId, text, appUrl);
		console.log(`[рассылка] тест на ${testId}: ${result}`);
		return;
	}

	const { client, url } = connect();
	console.log(`[рассылка] база: ${url.split('?')[0]}`);

	const rows = await client.execute(
		`SELECT telegram_user_id FROM users WHERE telegram_user_id NOT LIKE 'deleted:%'`
	);
	const recipients = [...new Set(rows.rows.map((row) => String(row.telegram_user_id)))];

	console.log(`[рассылка] получателей: ${recipients.length}`);

	if (!confirm) {
		console.log('[рассылка] отправить всем — добавьте --confirm');
		return;
	}

	const tally: Record<SendResult, number> = { sent: 0, blocked: 0, failed: 0 };

	for (const chatId of recipients) {
		tally[await send(token, chatId, text, appUrl)]++;
		await sleep(DELAY_MS);
	}

	console.log(
		`[рассылка] готово: доставлено ${tally.sent}, недоступны ${tally.blocked}, ошибок ${tally.failed}`
	);
}

void main()
	.catch((error) => {
		console.error(error instanceof Stop ? `[рассылка] ${error.message}` : error);
		process.exitCode = 1;
	})
	.finally(() => open?.close());
