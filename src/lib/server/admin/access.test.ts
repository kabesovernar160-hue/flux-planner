import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { INIT_DATA_HEADER } from '../auth/session';
import { signInitData } from '../telegram/initData';
import { GET } from '../../../routes/api/admin/stats/+server';
import { isAdminTelegramId, parseAdminIds } from './access';

/**
 * Статистика видна только владельцу.
 *
 * Эндпоинт вызывается напрямую, как это сделал бы SvelteKit: проверяется
 * вся цепочка — подпись, пользователь, список администраторов.
 */

const TOKEN = '8585094426:TEST-TOKEN-NOT-REAL';
const OWNER = 1145673466;

beforeAll(() => {
	process.env.DATABASE_URL = ':memory:';
	process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});

afterEach(() => {
	delete process.env.ADMIN_TELEGRAM_IDS;
});

function signedFor(telegramId: number): string {
	return signInitData(
		{
			auth_date: String(Math.floor(Date.now() / 1000)),
			user: JSON.stringify({ id: telegramId, first_name: 'Аня' })
		},
		TOKEN
	);
}

function call(initData?: string): Promise<Response> {
	const request = new Request('http://localhost/api/admin/stats', {
		headers: initData ? { [INIT_DATA_HEADER]: initData } : {}
	});
	return GET({ request } as Parameters<typeof GET>[0]) as Promise<Response>;
}

describe('список администраторов', () => {
	it('по умолчанию — владелец', () => {
		expect(isAdminTelegramId(String(OWNER), undefined)).toBe(true);
		expect(isAdminTelegramId(String(OWNER), '  ')).toBe(true);
		expect(isAdminTelegramId('123456789', undefined)).toBe(false);
	});

	it('переменная через запятую заменяет умолчание', () => {
		expect([...parseAdminIds('111111111, 222222222')]).toEqual(['111111111', '222222222']);
		expect(isAdminTelegramId(String(OWNER), '111111111')).toBe(false);
	});

	it('мусор в списке никого не пускает', () => {
		expect(isAdminTelegramId('deleted:abc', 'deleted:abc')).toBe(false);
	});
});

describe('GET /api/admin/stats', () => {
	it('без подписи — 404, а не 401: эндпоинт не выдаёт себя', async () => {
		expect((await call()).status).toBe(404);
		expect((await call('user=%7B%22id%22%3A1%7D&hash=deadbeef')).status).toBe(404);
	});

	it('обычному пользователю — 404', async () => {
		const response = await call(signedFor(123456789));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
	});

	it('владельцу — цифры', async () => {
		const response = await call(signedFor(OWNER));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(body.cohorts).toHaveLength(body.windowDays);
		expect(body.totals.started).toBeGreaterThanOrEqual(2);
	});

	it('администратор из переменной окружения', async () => {
		process.env.ADMIN_TELEGRAM_IDS = '123456789';

		expect((await call(signedFor(123456789))).status).toBe(200);
		expect((await call(signedFor(OWNER))).status).toBe(404);
	});
});
