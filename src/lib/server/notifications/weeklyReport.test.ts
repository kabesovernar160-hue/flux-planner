import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type Db } from '../db/client';
import { createRepositories, type Repositories } from '../db/repositories';
import type { UserRow } from '../db/schema';
import {
	buildWeeklyMessage,
	isWeeklyReportTime,
	runWeeklyReports,
	sendWeeklyReport,
	weeklyReportKeyboard
} from './notificationService';

/** Воскресенье, 27 сентября 2026, 19:00 в Москве (UTC+3). */
const SUNDAY_19_MSK = new Date('2026-09-27T16:00:00.000Z');
const STAMP = '2026-09-21T08:00:00.000Z';

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
		timezone: 'Europe/Moscow',
		now: STAMP
	});
	await db.run(`UPDATE users SET timezone = 'Europe/Moscow' WHERE id = 'u1'`);
	user = { ...user, timezone: 'Europe/Moscow' };
});

async function addFood(date: string, calories: number) {
	await repositories.food.upsertMany(user.id, [
		{
			id: `food-${date}-${calories}`,
			createdAt: STAMP,
			updatedAt: STAMP,
			deletedAt: null,
			date,
			name: 'Обед',
			calories,
			protein: 0,
			fat: 0,
			carbs: 0,
			source: 'manual'
		} as never
	]);
}

async function addHabitDoneEveryDay(fromDay: number, toDay: number) {
	await repositories.habits.upsertMany(user.id, [
		{
			id: 'water',
			createdAt: '2026-09-01T08:00:00.000Z',
			updatedAt: STAMP,
			deletedAt: null,
			name: 'Вода',
			icon: 'drop',
			frequency: 'daily',
			archived: false
		} as never
	]);

	const rows = [];
	for (let day = fromDay; day <= toDay; day++) {
		const date = `2026-09-${String(day).padStart(2, '0')}`;
		rows.push({
			id: `done-${date}`,
			createdAt: STAMP,
			updatedAt: STAMP,
			deletedAt: null,
			habitId: 'water',
			date,
			completed: true
		});
	}
	await repositories.completions.upsertMany(user.id, rows as never);
}

describe('когда присылать', () => {
	it('воскресенье, 19:00 по времени пользователя', () => {
		expect(isWeeklyReportTime('Europe/Moscow', 20, SUNDAY_19_MSK)).toBe(true);
		// В тот же момент во Владивостоке уже понедельник.
		expect(isWeeklyReportTime('Asia/Vladivostok', 20, SUNDAY_19_MSK)).toBe(false);
		// В Лондоне воскресенье, но ещё 17:00.
		expect(isWeeklyReportTime('Europe/London', 20, SUNDAY_19_MSK)).toBe(false);
	});

	it('прежнее расписание «всем сразу» присылает в любой час воскресенья', () => {
		expect(isWeeklyReportTime('Europe/Moscow', undefined, new Date('2026-09-27T09:00:00Z'))).toBe(
			true
		);
		expect(isWeeklyReportTime('Europe/Moscow', undefined, new Date('2026-09-26T09:00:00Z'))).toBe(
			false
		);
	});
});

describe('сообщение', () => {
	it('три строки итогов и заголовок с датами недели', async () => {
		await addHabitDoneEveryDay(21, 26);
		await addFood('2026-09-21', 2100);
		await addFood('2026-09-22', 2900);

		const message = await buildWeeklyMessage(db, user, SUNDAY_19_MSK);
		const text = message.text.replace(/ /g, ' ');

		expect(text.split('\n')).toEqual([
			'Итоги недели, 21–27 сентября',
			'',
			'Привычки: 86 % · серия 6 дней',
			'Калории в цели 1 из 2 дней',
			'Траты: записей не было'
		]);
	});

	it('кнопка открывает Mini App сразу на экране недели', () => {
		expect(weeklyReportKeyboard('https://flux.example/')).toEqual({
			inline_keyboard: [
				[{ text: '📊 Открыть итоги', web_app: { url: 'https://flux.example/week' } }]
			]
		});
		expect(weeklyReportKeyboard(undefined)).toBeUndefined();
	});
});

describe('отправка', () => {
	it('уходит в чат с кнопкой', async () => {
		await addFood('2026-09-23', 2000);
		const send = vi.fn(async () => {});

		const sent = await sendWeeklyReport(db, user, {
			now: SUNDAY_19_MSK,
			send,
			miniAppUrl: 'https://flux.example'
		});

		expect(sent).toBe(true);
		expect(send).toHaveBeenCalledWith(
			'111',
			expect.stringContaining('Итоги недели'),
			expect.objectContaining({ replyMarkup: weeklyReportKeyboard('https://flux.example') })
		);
	});

	it('не пишет за неделю без записей', async () => {
		const send = vi.fn(async () => {});
		expect(await sendWeeklyReport(db, user, { now: SUNDAY_19_MSK, send })).toBe(false);
		expect(send).not.toHaveBeenCalled();
	});

	it('уважает выключенные уведомления', async () => {
		await addFood('2026-09-23', 2000);
		await repositories.planner.save({
			userId: user.id,
			schemaVersion: 4,
			settings: { notifications: { dailySummary: false } },
			updatedAt: STAMP
		});
		const send = vi.fn(async () => {});

		expect(await sendWeeklyReport(db, user, { now: SUNDAY_19_MSK, send })).toBe(false);
		expect(send).not.toHaveBeenCalled();
	});

	it('повторный вызов планировщика в тот же час не дублирует сообщение', async () => {
		await addFood('2026-09-23', 2000);
		const send = vi.fn(async () => {});

		await sendWeeklyReport(db, user, { now: SUNDAY_19_MSK, send });
		await sendWeeklyReport(db, user, { now: SUNDAY_19_MSK, send });

		expect(send).toHaveBeenCalledTimes(1);
	});

	it('без токена бота только пишет в журнал', async () => {
		await addFood('2026-09-23', 2000);
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});

		expect(await sendWeeklyReport(db, user, { now: SUNDAY_19_MSK, botToken: '' })).toBe(true);
		expect(info).toHaveBeenCalledWith(expect.stringContaining('Итоги недели, 21–27 сентября'));
		info.mockRestore();
	});

	it('проход планировщика трогает только тех, у кого сейчас вечер воскресенья', async () => {
		await addFood('2026-09-23', 2000);
		const send = vi.fn(async () => {});
		const other = { ...user, id: 'u2', telegramUserId: '222', timezone: 'Asia/Vladivostok' };

		const result = await runWeeklyReports(db, [user, other], {
			now: SUNDAY_19_MSK,
			localHour: 20,
			send
		});

		expect(result).toEqual({ sent: 1, skipped: 1, failed: 0 });
	});
});
