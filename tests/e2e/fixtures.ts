import { test as base, expect, type Page } from '@playwright/test';

/**
 * Общая подготовка страницы.
 *
 * SDK Telegram подменяется пустым скриптом: вне клиента Telegram он всё равно
 * ничего не делает, а сетевой запрос к telegram.org делал бы тесты зависимыми
 * от внешнего сайта и сыпал ошибками в консоль там, где сеть закрыта.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
	consoleErrors: async ({ page }, use) => {
		const errors: string[] = [];

		page.on('console', (message) => {
			if (message.type() === 'error') errors.push(message.text());
		});
		page.on('pageerror', (error) => errors.push(error.message));

		await use(errors);
	},

	page: async ({ page }, use) => {
		await page.route('https://telegram.org/**', (route) =>
			route.fulfill({ body: '', contentType: 'application/javascript' })
		);
		await use(page);
	}
});

export { expect };

/**
 * Открыть приложение новичком.
 *
 * `?seed=off` выключает демо-сид dev-сервера: без этого пустое хранилище
 * сразу наполняется примерами, и первый запуск не увидеть.
 */
export async function openAsNewcomer(page: Page, { seed = false } = {}): Promise<void> {
	await page.goto(seed ? '/' : '/?seed=off');
}

/** Пройти приветствие кнопкой «Пропустить». */
export async function skipOnboarding(page: Page): Promise<void> {
	const onboarding = page.getByRole('heading', { name: 'Flux Planner' });
	await expect(onboarding).toBeVisible();
	await page.getByRole('button', { name: 'Пропустить' }).click();
	await expect(onboarding).toBeHidden();
}

/** Нет ли горизонтального переполнения: вёрстка не шире окна. */
export async function horizontalOverflow(page: Page): Promise<number> {
	return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
