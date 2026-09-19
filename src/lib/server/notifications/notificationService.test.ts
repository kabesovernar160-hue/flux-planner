import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../db/client';
import { createRepositories, type Repositories } from '../db/repositories';
import type { UserRow } from '../db/schema';
import { buildDailySummary, dailySummaryEnabled } from './notificationService';

const DATE = '2026-01-15';
let db: Db;
let repositories: Repositories;
let user: UserRow;

beforeEach(async () => {
	db = await createTestDb();
	repositories = createRepositories(db);
	user = await repositories.users.upsertFromTelegram({
		id: 'u1',
		telegramUserId: '111',
		firstName: 'Алиса',
		timezone: 'UTC',
		now: '2026-01-15T08:00:00.000Z'
	});
});

const stamps = { createdAt: '2026-01-15T08:00:00.000Z', updatedAt: '2026-01-15T08:00:00.000Z' };

/**
 * Форматирование денег вставляет неразрывный пробел как разделитель разрядов.
 * Для сообщения это правильно, но сравнивать удобнее по обычному пробелу.
 */
const normalize = (text: string) => text.replace(/ /g, ' ');

describe('dailySummaryEnabled', () => {
	it('без настроек считает уведомления включёнными', () => {
		// У тех, кто пользовался приложением до появления переключателя,
		// поведение не должно измениться молча.
		expect(dailySummaryEnabled(null)).toBe(true);
		expect(dailySummaryEnabled({})).toBe(true);
		expect(dailySummaryEnabled({ notifications: {} })).toBe(true);
	});

	it('выключает только по явному false', () => {
		expect(dailySummaryEnabled({ notifications: { dailySummary: false } })).toBe(false);
		expect(dailySummaryEnabled({ notifications: { dailySummary: true } })).toBe(true);
	});

	it('не падает на чужой форме настроек', () => {
		expect(dailySummaryEnabled('строка')).toBe(true);
		expect(dailySummaryEnabled({ notifications: 'да' })).toBe(true);
	});
});

describe('buildDailySummary', () => {
	it('на пустом дне помечает отсутствие данных', async () => {
		const summary = await buildDailySummary(db, user, DATE);

		// Сводка из одних нулей — это спам, а не полезное напоминание.
		expect(summary.hasData).toBe(false);
	});

	it('считает калории из записей', async () => {
		await repositories.food.upsertMany(user.id, [
			{
				id: 'f1',
				...stamps,
				date: DATE,
				name: 'Овсянка',
				calories: 420,
				protein: 14,
				fat: 9,
				carbs: 68,
				source: 'manual'
			} as never
		]);

		const summary = await buildDailySummary(db, user, DATE);

		expect(summary.hasData).toBe(true);
		expect(summary.text).toContain('Калории: 420 из 2100');
	});

	it('считает траты и отмечает превышение лимита', async () => {
		await repositories.financeDays.upsertMany(user.id, [
			{ id: 'b1', ...stamps, date: DATE, budget: 1000 } as never
		]);
		await repositories.finance.upsertMany(user.id, [
			{ id: 'e1', ...stamps, date: DATE, type: 'expense', amount: 1400, category: 'food' } as never
		]);

		const summary = await buildDailySummary(db, user, DATE);

		expect(normalize(summary.text)).toContain('Траты: 1 400 ₽ из 1 000 ₽');
		expect(normalize(summary.text)).toContain('Лимит превышен на 400 ₽');
	});

	it('считает привычки от запланированных на день', async () => {
		await repositories.habits.upsertMany(user.id, [
			{
				id: 'h1',
				...stamps,
				name: 'Зарядка',
				icon: 'barbell',
				frequency: 'daily',
				archived: false
			} as never,
			{
				id: 'h2',
				...stamps,
				name: 'Чтение',
				icon: 'book',
				frequency: 'daily',
				archived: false
			} as never
		]);
		await repositories.completions.upsertMany(user.id, [
			{ id: 'c1', ...stamps, habitId: 'h1', date: DATE, completed: true } as never
		]);

		expect((await buildDailySummary(db, user, DATE)).text).toContain('Привычки: 1 из 2');
	});

	it('удалённые записи в сводку не попадают', async () => {
		await repositories.food.upsertMany(user.id, [
			{
				id: 'f1',
				createdAt: stamps.createdAt,
				updatedAt: '2026-01-15T09:00:00.000Z',
				deletedAt: '2026-01-15T09:00:00.000Z',
				date: DATE,
				name: 'Удалённое',
				calories: 999,
				protein: 0,
				fat: 0,
				carbs: 0,
				source: 'manual'
			} as never
		]);

		const summary = await buildDailySummary(db, user, DATE);
		expect(summary.text).toContain('Калории: 0 из 2100');
	});

	it('чужие записи в сводку не попадают', async () => {
		const other = await repositories.users.upsertFromTelegram({
			id: 'u2',
			telegramUserId: '222',
			now: stamps.createdAt
		});

		await repositories.food.upsertMany(other.id, [
			{
				id: 'f-other',
				...stamps,
				date: DATE,
				name: 'Чужое',
				calories: 999,
				protein: 0,
				fat: 0,
				carbs: 0,
				source: 'manual'
			} as never
		]);

		expect((await buildDailySummary(db, user, DATE)).text).toContain('Калории: 0 из 2100');
	});
});
