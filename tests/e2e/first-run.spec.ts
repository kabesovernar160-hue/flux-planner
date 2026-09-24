import { expect, openAsNewcomer, skipOnboarding, test } from './fixtures';

test.describe('первый запуск', () => {
	test('приветствие пропускается и больше не показывается', async ({ page }) => {
		await openAsNewcomer(page);
		await skipOnboarding(page);

		// Пропуск — не «закрыть до следующего раза»: отметка лежит в настройках.
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Начни с одного' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Flux Planner' })).toBeHidden();
	});

	test('пустая главная предлагает три первых действия', async ({ page }) => {
		await openAsNewcomer(page);
		await skipOnboarding(page);

		await expect(page.getByRole('heading', { name: 'Начни с одного' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Сфоткать еду' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Добавить привычку' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Записать трату' })).toBeVisible();

		// Карточек с нулями на пустой главной быть не должно.
		await expect(page.locator('#habits-card')).toHaveCount(0);
	});

	test('готовая привычка появляется на главной в одно касание', async ({ page }) => {
		await openAsNewcomer(page);
		await skipOnboarding(page);

		await page.getByRole('button', { name: 'Зарядка' }).click();

		await expect(page.getByRole('heading', { name: 'Начни с одного' })).toBeHidden();
		await expect(page.getByRole('checkbox', { name: 'Зарядка' })).toBeVisible();
		await expect(page.getByRole('status')).toContainText('Первая запись есть');

		// Привычка настоящая, а не нарисованная: она есть и на своём экране.
		await page.goto('/habits');
		await expect(page.getByRole('checkbox', { name: 'Зарядка' })).toBeVisible();
	});

	test('«Сфоткать еду» открывает сканер', async ({ page }) => {
		await openAsNewcomer(page);
		await skipOnboarding(page);

		await page.getByRole('button', { name: 'Сфоткать еду' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
	});

	test('после анкеты сразу предлагается первое действие', async ({ page }) => {
		await openAsNewcomer(page);

		await page.getByRole('button', { name: 'Посчитать цели' }).click();
		await page.getByLabel('Возраст').fill('30');
		await page.getByLabel('Рост, см').fill('175');
		await page.getByLabel('Вес, кг').fill('70');
		await page.getByRole('button', { name: 'Дальше' }).click();
		await page.getByRole('button', { name: 'Показать цели' }).click();
		await page.getByRole('button', { name: 'Применить' }).click();

		await expect(page.getByRole('heading', { name: 'Цели готовы' })).toBeVisible();
		// Главная под слоем приветствия тоже пустая и с теми же кнопками:
		// нажимать нужно ту, что в самом приветствии.
		await page
			.getByRole('dialog', { name: 'Первый запуск' })
			.getByRole('button', { name: 'Чтение' })
			.click();

		await expect(page.getByRole('heading', { name: 'Цели готовы' })).toBeHidden();
		await expect(page.getByRole('checkbox', { name: 'Чтение' })).toBeVisible();
	});
});

test.describe('подсказка у «+»', () => {
	const hint = 'Всё добавляется отсюда';

	test('показывается один раз и закрывается касанием', async ({ page }) => {
		await openAsNewcomer(page);
		await skipOnboarding(page);

		const bubble = page.getByRole('button', { name: hint });
		await expect(bubble).toBeVisible();
		await bubble.click();
		await expect(bubble).toBeHidden();

		await page.reload();
		await expect(page.getByRole('heading', { name: 'Начни с одного' })).toBeVisible();
		await expect(page.getByRole('button', { name: hint })).toHaveCount(0);
	});

	test('не всплывает поверх приветствия', async ({ page }) => {
		await openAsNewcomer(page);
		await expect(page.getByRole('heading', { name: 'Flux Planner' })).toBeVisible();
		await expect(page.getByRole('button', { name: hint })).toHaveCount(0);
	});
});
