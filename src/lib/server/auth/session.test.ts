import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthError, INIT_DATA_HEADER, requireUser } from './session';
import { signInitData } from '../telegram/initData';

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
