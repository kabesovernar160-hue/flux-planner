import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthError, INIT_DATA_HEADER, requireUser } from './session';
import { signInitData } from '../telegram/initData';
import { getReadyDb } from '../db/client';
import { createDeviceSession, DEVICE_COOKIE, revokeDeviceSession } from './deviceSessions';

/**
 * Проверка входа в защищённые эндпоинты.
 *
 * Здесь же закрывается главное правило безопасности: пользователь берётся
 * ИСКЛЮЧИТЕЛЬНО из проверенной подписи, а не из того, что клиент написал
 * о себе в запросе.
 */

const TOKEN = '8585094426:TEST-TOKEN-NOT-REAL';
const OTHER_TOKEN = '8585094426:ANOTHER-TOKEN';

beforeAll(() => {
	// База в памяти: тесту не нужен файл рядом с проектом.
	process.env.DATABASE_URL = ':memory:';
	process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});

afterEach(() => {
	process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});

function request(initData?: string, body?: unknown): Request {
	return new Request('http://localhost/api/nutrition/analyze', {
		method: 'POST',
		headers: initData ? { [INIT_DATA_HEADER]: initData } : {},
		body: body ? JSON.stringify(body) : undefined
	});
}

function signedFor(telegramId: number, token = TOKEN, ageSeconds = 0): string {
	return signInitData(
		{
			auth_date: String(Math.floor(Date.now() / 1000) - ageSeconds),
			user: JSON.stringify({ id: telegramId, first_name: 'Аня', username: 'anya' })
		},
		token
	);
}

describe('requireUser', () => {
	it('отказывает запросу без данных авторизации', async () => {
		await expect(requireUser(request())).rejects.toMatchObject({
			code: 'UNAUTHENTICATED',
			status: 401
		});
	});

	it('отказывает на мусоре вместо initData', async () => {
		await expect(requireUser(request('not-a-signature'))).rejects.toBeInstanceOf(AuthError);
		await expect(
			requireUser(request('user=%7B%22id%22%3A1%7D&hash=deadbeef'))
		).rejects.toMatchObject({ status: 401 });
	});

	it('отказывает на подписи чужим токеном', async () => {
		await expect(requireUser(request(signedFor(1, OTHER_TOKEN)))).rejects.toMatchObject({
			status: 401
		});
	});

	it('отказывает на просроченной подписи', async () => {
		// Без проверки давности перехваченная строка оставалась бы пропуском навсегда.
		await expect(requireUser(request(signedFor(1, TOKEN, 48 * 60 * 60)))).rejects.toMatchObject({
			status: 401
		});
	});

	it('пускает по корректной подписи и заводит пользователя', async () => {
		const { user } = await requireUser(request(signedFor(4242)));

		expect(user.telegramUserId).toBe('4242');
		expect(user.firstName).toBe('Аня');
	});

	it('не создаёт второго пользователя на повторный вход', async () => {
		const first = await requireUser(request(signedFor(777)));
		const second = await requireUser(request(signedFor(777)));

		expect(second.user.id).toBe(first.user.id);
	});

	it('игнорирует идентификатор, присланный клиентом в теле запроса', async () => {
		const { user } = await requireUser(request(signedFor(100), { telegram_user_id: '999' }));

		expect(user.telegramUserId).toBe('100');
	});

	it('без токена бота не пускает никого', async () => {
		// Проверить подпись физически нечем. Пропускать всех в таком
		// состоянии — открытая дверь в чужие данные.
		delete process.env.TELEGRAM_BOT_TOKEN;

		await expect(requireUser(request(signedFor(1)))).rejects.toMatchObject({
			code: 'NOT_CONFIGURED',
			status: 500
		});
	});
});

describe('requireUser: сессия устройства', () => {
	/**
	 * Приложение на главном экране телефона ходит с кукой, а не с подписью.
	 * Дверь та же: один requireUser для обоих способов.
	 */
	async function deviceCookieFor(telegramId: number) {
		const { user } = await requireUser(request(signedFor(telegramId)));
		const issued = await createDeviceSession(await getReadyDb(), user.id);
		return { user, ...issued };
	}

	function withCookie(
		cookie: string,
		init: { method?: string; origin?: string; initData?: string } = {}
	): Request {
		const headers: Record<string, string> = { cookie: `other=1; ${DEVICE_COOKIE}=${cookie}` };
		if (init.origin) headers.origin = init.origin;
		if (init.initData) headers[INIT_DATA_HEADER] = init.initData;

		return new Request('http://localhost/api/sync/pull', {
			method: init.method ?? 'GET',
			headers
		});
	}

	it('пускает по действующей куке того же человека', async () => {
		const { user, cookie } = await deviceCookieFor(5001);

		const session = await requireUser(withCookie(cookie));

		expect(session.user.id).toBe(user.id);
		expect(session.auth.kind).toBe('device');
	});

	it('Telegram-вход помечен своим видом', async () => {
		const session = await requireUser(request(signedFor(5002)));

		expect(session.auth.kind).toBe('telegram');
	});

	it('отозванная кука не пускает', async () => {
		const { user, cookie, session } = await deviceCookieFor(5003);
		await revokeDeviceSession(await getReadyDb(), user.id, session.id);

		await expect(requireUser(withCookie(cookie))).rejects.toMatchObject({
			code: 'UNAUTHENTICATED',
			status: 401
		});
	});

	it('испорченная кука не пускает', async () => {
		await expect(requireUser(withCookie('abc.def'))).rejects.toMatchObject({ status: 401 });
	});

	it('при заголовке initData решает только подпись, кука не спасает', async () => {
		const { cookie } = await deviceCookieFor(5004);

		await expect(
			requireUser(withCookie(cookie, { initData: signedFor(5004, OTHER_TOKEN) }))
		).rejects.toMatchObject({ status: 401 });
	});

	it('изменяющий запрос с чужого сайта отклоняется', async () => {
		const { cookie } = await deviceCookieFor(5005);

		await expect(
			requireUser(withCookie(cookie, { method: 'POST', origin: 'https://evil.example' }))
		).rejects.toMatchObject({ code: 'FORBIDDEN_ORIGIN', status: 403 });

		const own = await requireUser(
			withCookie(cookie, { method: 'POST', origin: 'http://localhost' })
		);
		expect(own.auth.kind).toBe('device');
	});

	it('сессия устройства работает и без токена бота', async () => {
		// Подпись Telegram здесь не участвует, и её настройка не должна
		// выключать уже вошедшие телефоны.
		const { cookie } = await deviceCookieFor(5006);
		delete process.env.TELEGRAM_BOT_TOKEN;

		const session = await requireUser(withCookie(cookie));
		expect(session.auth.kind).toBe('device');
	});
});
