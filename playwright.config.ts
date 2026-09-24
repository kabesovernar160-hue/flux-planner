import { defineConfig } from '@playwright/test';

/**
 * Автотесты интерфейса.
 *
 * Гоняются против dev-сервера, а не сборки: в dev распознавание работает
 * на детерминированном моке и приложению не нужны секреты, поэтому тесты
 * запускаются на любой машине сразу после npm install. Сервер поднимается
 * сам; уже запущенный локально переиспользуется, чтобы не ждать сборку.
 *
 * Вьюпорт — айфон средней величины: Mini App живёт только в телефоне,
 * и горизонтальное переполнение на десктопной ширине не поймать.
 */
const PORT = 5173;

export default defineConfig({
	testDir: 'tests/e2e',
	// Первая компиляция страниц dev-сервером занимает секунды — отсюда запас.
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	reporter: process.env.CI ? 'github' : 'list',

	use: {
		baseURL: `http://localhost:${PORT}`,
		browserName: 'chromium',
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2,
		isMobile: true,
		hasTouch: true,
		locale: 'ru-RU',
		trace: 'retain-on-failure'
	},

	webServer: {
		command: `npm run dev -- --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
