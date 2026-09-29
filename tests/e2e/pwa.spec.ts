import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { test as base, expect, type Page } from '@playwright/test';

/**
 * Приложение на главном экране телефона, без Telegram.
 *
 * Здесь нет подмены «Пользоваться без входа», как в fixtures.ts: проверяется
 * ровно то, что увидит человек, открывший сайт в Safari или Chrome.
 *
 * Код входа кладётся прямо в базу dev-сервера — ту же, что он читает
 * (DATABASE_URL или file:flux-planner.db по умолчанию). Бот в этом тесте
 * не нужен: его часть проверяет tests/integration/phone-login.test.ts.
 *
 * SCREENSHOTS=1 дополнительно снимает экран входа и инструкцию установки
 * в обеих темах в docs/screenshots/pwa/.
 */

const test = base.extend({
	page: async ({ page }, use) => {
		await page.route('https://telegram.org/**', (route) =>
			route.fulfill({ body: '', contentType: 'application/javascript' })
		);
		await use(page);
	}
});

// Тесты пишут в одну базу с сервером — по очереди надёжнее.
test.describe.configure({ mode: 'serial' });

const IPHONE_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SHOTS = 'docs/screenshots/pwa';

function databaseUrl(): string {
	const url = process.env.DATABASE_URL?.trim() || 'file:flux-planner.db';
	return url.startsWith('file:') || url.includes('://') ? url : `file:${url}`;
}

/** Пользователь и свежий код входа — как их заводит бот по /phone. */
async function issueLoginToken(telegramId: string, firstName: string): Promise<string> {
	const db = createClient({ url: databaseUrl() });
	const now = new Date();
	const token = Array.from(randomBytes(10), (byte) => ALPHABET[byte & 31]).join('');

	try {
		// База общая с dev-сервером: подождать его запись, а не падать с BUSY.
		await db.execute('PRAGMA busy_timeout = 5000');
		// Предел попыток входа считается по адресу, а тесты всегда с localhost:
		// повторные прогоны на той же базе упирались бы в него.
		await db.execute(`DELETE FROM rate_limits WHERE key LIKE 'login:ip:%'`);
		await db.execute({
			sql: `INSERT INTO users (id, telegram_user_id, first_name, timezone, created_at, updated_at)
			      VALUES (?, ?, ?, 'Europe/Moscow', ?, ?)
			      ON CONFLICT (telegram_user_id) DO NOTHING`,
			args: [`e2e-${telegramId}`, telegramId, firstName, now.toISOString(), now.toISOString()]
		});
		const user = await db.execute({
			sql: 'SELECT id FROM users WHERE telegram_user_id = ?',
			args: [telegramId]
		});
		await db.execute({
			sql: `INSERT INTO login_tokens (id, user_id, token_hash, created_at, expires_at)
			      VALUES (?, ?, ?, ?, ?)`,
			args: [
				`e2e-${token}`,
				String(user.rows[0].id),
				createHash('sha256').update(token).digest('hex'),
				now.toISOString(),
				new Date(now.getTime() + 10 * 60_000).toISOString()
			]
		});
	} finally {
		db.close();
	}

	return token;
}

async function waitForSchema(page: Page): Promise<void> {
	// Схему создаёт сервер при старте; первый запрос к API её гарантирует.
	await page.request.get('/api/health');
}

test.describe('приложение без Telegram', () => {
	test('манифест отдаётся и описывает приложение', async ({ request }) => {
		const response = await request.get('/manifest.webmanifest');
		expect(response.ok()).toBe(true);

		const manifest = await response.json();
		expect(manifest).toMatchObject({
			name: 'Flux Planner',
			short_name: 'Flux',
			display: 'standalone',
			start_url: '/?source=pwa',
			lang: 'ru'
		});
		expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toContain('maskable');

		for (const icon of manifest.icons as { src: string }[]) {
			expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
		}
		expect((await request.get('/apple-touch-icon.png')).ok()).toBe(true);
	});

	test('без входа открывается экран входа, а сервис-воркер регистрируется', async ({ page }) => {
		await page.goto('/');

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('heading', { name: 'Войдите через бота' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0);

		const scope = await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready;
			return registration.scope;
		});
		expect(new URL(scope).pathname).toBe('/');
	});

	test('вход по ссылке из бота приводит на главный экран', async ({ page, context }) => {
		await waitForSchema(page);
		const token = await issueLoginToken('900001', 'Аня');

		await page.goto(`/login?token=${token}`);
		await page.getByRole('button', { name: 'Войти на этом устройстве' }).click();

		await expect(page.getByRole('heading', { name: 'Добавьте на главный экран' })).toBeVisible();
		await expect(page.getByText('Вы вошли, Аня')).toBeVisible();
		// Погашенный код не остаётся в адресной строке.
		await expect(page).toHaveURL(/\/login$/);

		const cookie = (await context.cookies()).find((item) => item.name === 'fx_session');
		expect(cookie?.httpOnly).toBe(true);
		expect(cookie?.sameSite).toBe('Lax');

		await page.getByRole('button', { name: 'Открыть мой день' }).click();
		await expect(page).toHaveURL('/');
		await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();

		// После перезапуска вход держится по куке, экрана входа нет.
		await page.reload();
		await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
		await expect(page).toHaveURL('/');

		// Код одноразовый: вторая попытка получает честный отказ.
		const again = await page.request.post('/api/auth/login', { data: { token } });
		expect(again.status()).toBe(401);
	});

	test('код из бота можно ввести руками', async ({ page }) => {
		await waitForSchema(page);
		const token = await issueLoginToken('900002', 'Борис');

		await page.goto('/login');
		await page
			.getByLabel('Код из бота')
			.fill(`${token.slice(0, 5)}-${token.slice(5)}`.toLowerCase());
		await page.getByRole('button', { name: 'Войти', exact: true }).click();

		await expect(page.getByText('Вы вошли, Борис')).toBeVisible();
	});
});

test.describe('снимки для документации', () => {
	test.skip(!process.env.SCREENSHOTS, 'снимки — по SCREENSHOTS=1');
	test.use({ userAgent: IPHONE_UA });

	for (const scheme of ['dark', 'light'] as const) {
		test(`экран входа и установка — ${scheme}`, async ({ page }) => {
			mkdirSync(SHOTS, { recursive: true });
			await page.emulateMedia({ colorScheme: scheme });
			await waitForSchema(page);

			await page.goto('/login');
			await expect(page.getByRole('heading', { name: 'Войдите через бота' })).toBeVisible();
			await page.waitForTimeout(700);
			await page.screenshot({ path: `${SHOTS}/login-${scheme}.png` });

			const token = await issueLoginToken(`90010${scheme === 'dark' ? 1 : 2}`, 'Аня');
			await page.goto(`/login?token=${token}`);
			await expect(page.getByRole('button', { name: 'Войти на этом устройстве' })).toBeVisible();
			await page.waitForTimeout(700);
			await page.screenshot({ path: `${SHOTS}/login-link-${scheme}.png` });

			await page.getByRole('button', { name: 'Войти на этом устройстве' }).click();
			await expect(page.getByRole('heading', { name: 'Добавьте на главный экран' })).toBeVisible();
			await page.waitForTimeout(700);
			await page.screenshot({ path: `${SHOTS}/install-ios-${scheme}.png` });
		});
	}
});
