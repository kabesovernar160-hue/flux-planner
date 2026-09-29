import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbForTests } from '$lib/server/db/client';
import { DEVICE_COOKIE } from '$lib/server/auth/deviceSessions';
import { PHONE_LOGIN_BUTTON } from '$lib/server/telegram/botMessages';

/**
 * Приложение на телефоне целиком: /phone в боте → ссылка → обмен кода
 * на куку → вход при запуске → выход.
 *
 * Bot API подменён шпионом; эндпоинты вызываются напрямую, с минимальной
 * заменой cookies из SvelteKit.
 */

const bot = vi.hoisted(() => ({
	sendMessage: vi.fn(async (..._args: unknown[]) => undefined),
	answerCallbackQuery: vi.fn(async (..._args: unknown[]) => undefined),
	editMessageReplyMarkup: vi.fn(async (..._args: unknown[]) => undefined)
}));

vi.mock('$lib/server/telegram/botApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/telegram/botApi')>()),
	...bot
}));

const webhook = await import('../../src/routes/api/telegram/webhook/+server');
const login = await import('../../src/routes/api/auth/login/+server');
const sessionEndpoint = await import('../../src/routes/api/auth/session/+server');
const logout = await import('../../src/routes/api/auth/logout/+server');
const devices = await import('../../src/routes/api/auth/devices/+server');

const SECRET = 'webhook-secret';
const APP_URL = 'https://flux.example.com';

beforeAll(() => {
	process.env.DATABASE_URL = ':memory:';
	process.env.TELEGRAM_BOT_TOKEN = '8585094426:TEST-TOKEN-NOT-REAL';
	process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
	process.env.TELEGRAM_MINI_APP_URL = APP_URL;
});

beforeEach(() => {
	resetDbForTests();
	vi.clearAllMocks();
});

/** Банка для куки: то, что эндпоинт поставил, уходит в следующий запрос. */
function jar() {
	const values = new Map<string, string>();

	return {
		header: () => [...values].map(([name, value]) => `${name}=${value}`).join('; '),
		get: (name: string) => values.get(name),
		cookies: {
			set: (name: string, value: string) => void values.set(name, value),
			delete: (name: string) => void values.delete(name),
			get: (name: string) => values.get(name)
		}
	};
}

type Jar = ReturnType<typeof jar>;

let address = 0;

function event(path: string, init: { method?: string; body?: unknown; jar?: Jar } = {}) {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1'
	};
	const cookie = init.jar?.header();
	if (cookie) headers.cookie = cookie;

	return {
		request: new Request(`${APP_URL}${path}`, {
			method: init.method ?? 'POST',
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body)
		}),
		url: new URL(`${APP_URL}${path}`),
		cookies: init.jar?.cookies ?? jar().cookies,
		// Свой адрес на каждый тест: предел попыток не должен перетекать.
		getClientAddress: () => `10.0.0.${address}`
	} as never;
}

async function askBotForLink(telegramId: number, text = '/phone'): Promise<string> {
	const response = await webhook.POST({
		request: new Request('http://localhost/api/telegram/webhook', {
			method: 'POST',
			headers: { 'x-telegram-bot-api-secret-token': SECRET, 'content-type': 'application/json' },
			body: JSON.stringify({
				message: {
					message_id: 1,
					chat: { id: telegramId },
					from: { id: telegramId, first_name: 'Аня' },
					text
				}
			})
		})
	} as never);
	expect(response.status).toBe(200);

	const [, , options] = bot.sendMessage.mock.calls.at(-1) as [
		number,
		string,
		{ replyMarkup: { inline_keyboard: { text: string; url?: string }[][] } }
	];
	const button = options.replyMarkup.inline_keyboard[0][0];
	expect(button.text).toBe(PHONE_LOGIN_BUTTON);

	return button.url as string;
}

describe('вход на телефоне по ссылке из бота', () => {
	beforeEach(() => {
		address += 1;
	});

	it('ссылка из бота → кука → вход при запуске → выход', async () => {
		const link = new URL(await askBotForLink(4242));
		expect(link.origin).toBe(APP_URL);
		expect(link.pathname).toBe('/login');

		const phone = jar();
		const exchanged = await login.POST(
			event('/api/auth/login', { body: { token: link.searchParams.get('token') }, jar: phone })
		);
		expect(exchanged.status).toBe(200);
		expect((await exchanged.json()).user.telegramUserId).toBe('4242');
		expect(phone.get(DEVICE_COOKIE)).toBeTruthy();

		const started = await sessionEndpoint.POST(event('/api/auth/session', { jar: phone }));
		expect(started.status).toBe(200);
		expect(await started.json()).toMatchObject({
			kind: 'device',
			user: { telegramUserId: '4242' }
		});

		const list = await devices.GET(event('/api/auth/devices', { method: 'GET', jar: phone }));
		const { devices: rows } = await list.json();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ current: true, label: 'iPhone · Safari' });

		const saved = phone.get(DEVICE_COOKIE) as string;
		expect((await logout.POST(event('/api/auth/logout', { body: {}, jar: phone }))).status).toBe(
			200
		);
		expect(phone.get(DEVICE_COOKIE)).toBeUndefined();

		// Даже сохранённая где-то копия куки больше не открывает дневник.
		const stale = jar();
		stale.cookies.set(DEVICE_COOKIE, saved);
		const after = await sessionEndpoint.POST(event('/api/auth/session', { jar: stale }));
		expect(after.status).toBe(401);
	});

	it('ссылку нельзя использовать второй раз', async () => {
		const token = new URL(await askBotForLink(777)).searchParams.get('token');

		expect((await login.POST(event('/api/auth/login', { body: { token } }))).status).toBe(200);
		expect((await login.POST(event('/api/auth/login', { body: { token } }))).status).toBe(401);
	});

	it('кнопка «📱 Приложение на телефон» и /start login дают ту же ссылку', async () => {
		expect(await askBotForLink(1001, '📱 Приложение на телефон')).toMatch(/\/login\?token=/);
		expect(await askBotForLink(1002, '/start login')).toMatch(/\/login\?token=/);
	});

	it('без сессии вход при запуске отвечает 401', async () => {
		const response = await sessionEndpoint.POST(event('/api/auth/session'));
		expect(response.status).toBe(401);
	});

	it('выдача кодов ограничена по частоте', async () => {
		for (let i = 0; i < 5; i += 1) await askBotForLink(3003);

		await webhook.POST({
			request: new Request('http://localhost/api/telegram/webhook', {
				method: 'POST',
				headers: { 'x-telegram-bot-api-secret-token': SECRET, 'content-type': 'application/json' },
				body: JSON.stringify({
					message: { message_id: 1, chat: { id: 3003 }, from: { id: 3003 }, text: '/phone' }
				})
			})
		} as never);

		const [, text, options] = bot.sendMessage.mock.calls.at(-1) as [number, string, unknown];
		expect(text).toMatch(/Подождите/);
		expect(options).toBeUndefined();
	});
});
