import { expect, horizontalOverflow, openAsNewcomer, skipOnboarding, test } from './fixtures';

/**
 * Все экраны нижнего меню плюс привычки: к ним ведёт «Все привычки»
 * с главной и кнопки на пустых экранах, отдельного пункта в меню нет.
 */
const SCREENS = [
	{ tab: 'Аналитика', path: '/analytics', heading: 'Аналитика' },
	{ tab: 'Календарь', path: '/calendar', heading: 'Календарь' },
	{ tab: 'Настройки', path: '/settings', heading: 'Настройки' },
	{ tab: 'Главная', path: '/', heading: null }
] as const;

for (const seed of [false, true]) {
	test(`нижнее меню: все экраны ${seed ? 'с демо-данными' : 'на пустом хранилище'}`, async ({
		page,
		consoleErrors
	}) => {
		await openAsNewcomer(page, { seed });
		await skipOnboarding(page);
		expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

		const nav = page.getByRole('navigation', { name: 'Основная навигация' });

		for (const screen of SCREENS) {
			await nav.getByRole('link', { name: screen.tab }).click();
			await expect(page).toHaveURL(screen.path);
			if (screen.heading) {
				await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible();
			}
			expect(await horizontalOverflow(page), screen.path).toBeLessThanOrEqual(0);
		}

		if (seed) {
			await page.getByRole('link', { name: 'Все привычки' }).click();
		} else {
			await page.goto('/habits');
		}
		await expect(page).toHaveURL('/habits');
		await expect(page.getByRole('heading', { level: 1, name: 'Привычки' })).toBeVisible();
		expect(await horizontalOverflow(page), '/habits').toBeLessThanOrEqual(0);

		expect(consoleErrors).toEqual([]);
	});
}
