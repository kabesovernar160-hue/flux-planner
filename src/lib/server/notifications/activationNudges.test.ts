import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { anonymousTelegramId } from '../account/deleteAccount';
import { createTestDb, type Db } from '../db/client';
import { createRepositories } from '../db/repositories';
import { activationNudges, users as usersTable, type UserRow } from '../db/schema';
import { BotApiError } from '../telegram/botApi';
import { FIRST_NUDGE_TEXT, SECOND_NUDGE_TEXT } from '../telegram/botMessages';
import {
	claimNudge,
	hasAnyRecord,
	pickNudge,
	runActivationNudges,
	SEND_INTERVAL_MS,
	type NudgeState
} from './activationNudges';

/**
 * Напоминания новичкам.
 *
 * Лишнее сообщение от бота стоит дороже пропущенного, поэтому проверяется
 * в первую очередь то, когда бот обязан молчать: запись уже есть, третье
 * напоминание, заблокированный бот, удалённый аккаунт, ночь.
 */

/** Знакомство: 20 сентября, 12:00 по Москве (пояс по умолчанию). */
const CONTACT = '2026-09-20T09:00:00.000Z';

const at = (iso: string) => new Date(iso);
const none: NudgeState = { firstSentAt: null, secondSentAt: null, blockedAt: null };

function pick(now: string, state: NudgeState | null = null, timezone = 'UTC', createdAt = CONTACT) {
	return pickNudge({ createdAt, timezone, now: at(now), state });
}

describe('когда какое напоминание', () => {
	it('первое — через час после знакомства, не раньше', () => {
		expect(pick('2026-09-20T09:30:00.000Z')).toBeNull();
		expect(pick('2026-09-20T10:00:00.000Z')).toBe('first');
		expect(pick('2026-09-20T10:00:00.000Z', none)).toBe('first');
	});

	it('ночью первое ждёт утра, а не приходит в час ночи', () => {
		// 23:30 по Москве — через час будет половина первого ночи.
		const late = '2026-09-20T20:30:00.000Z';
		expect(pick('2026-09-20T21:30:00.000Z', null, 'UTC', late)).toBeNull();
		// 09:00 по Москве следующего дня — можно.
		expect(pick('2026-09-21T06:00:00.000Z', null, 'UTC', late)).toBe('first');
	});

	it('больше суток спустя первое уже не отправляется', () => {
		expect(pick('2026-09-21T11:00:00.000Z')).toBeNull();
	});

	it('второе — на третий день, днём по местному времени', () => {
		const sent = { ...none, firstSentAt: '2026-09-20T10:00:00.000Z' };

		expect(pick('2026-09-22T10:00:00.000Z', sent)).toBe('second'); // 13:00
		expect(pick('2026-09-22T17:30:00.000Z', sent)).toBe('second'); // 20:30
		expect(pick('2026-09-22T08:00:00.000Z', sent)).toBeNull(); // 11:00 — рано
		expect(pick('2026-09-22T18:30:00.000Z', sent)).toBeNull(); // 21:30 — поздно
		expect(pick('2026-09-21T10:00:00.000Z', sent)).toBeNull(); // второй день
		expect(pick('2026-09-23T10:00:00.000Z', sent)).toBeNull(); // четвёртый
	});

	it('второе приходит и тем, кому первое не досталось', () => {
		expect(pick('2026-09-22T10:00:00.000Z')).toBe('second');
	});

	it('не больше двух за всю жизнь', () => {
		const both = {
			...none,
			firstSentAt: '2026-09-20T10:00:00.000Z',
			secondSentAt: '2026-09-22T10:00:00.000Z'
		};

		expect(pick('2026-09-22T11:00:00.000Z', both)).toBeNull();
		expect(
			pick('2026-09-20T11:00:00.000Z', { ...none, secondSentAt: both.secondSentAt })
		).toBeNull();
	});

	it('между напоминаниями не меньше полусуток', () => {
		// Первое задержалось до утра третьего дня — второе в тот же день не идёт.
		const recent = { ...none, firstSentAt: '2026-09-22T06:00:00.000Z' };
		expect(pick('2026-09-22T10:00:00.000Z', recent)).toBeNull();
	});

	it('заблокированному боту — ничего', () => {
		const blocked = { ...none, blockedAt: '2026-09-20T09:10:00.000Z' };

		expect(pick('2026-09-20T10:00:00.000Z', blocked)).toBeNull();
		expect(pick('2026-09-22T10:00:00.000Z', blocked)).toBeNull();
	});

	it('заданный пояс важнее московского по умолчанию', () => {
		// 12:00 по Владивостоку 22-го — это 02:00 UTC.
		expect(pick('2026-09-22T02:00:00.000Z', null, 'Asia/Vladivostok')).toBe('second');
		expect(pick('2026-09-22T02:00:00.000Z', null, 'UTC')).toBeNull();
	});
});

describe('проход планировщика', () => {
	let db: Db;
	let send: ReturnType<typeof vi.fn>;
	let sleep: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		db = await createTestDb();
		send = vi.fn(async () => undefined);
		sleep = vi.fn(async () => undefined);
	});

	async function user(telegramId: string, createdAt = CONTACT): Promise<UserRow> {
		return createRepositories(db).users.upsertFromTelegram({
			id: `u-${telegramId}`,
			telegramUserId: telegramId,
			now: createdAt
		});
	}

	async function users(): Promise<UserRow[]> {
		return createRepositories(db).users.listAll();
	}

	function run(now: string) {
		return runActivationNudges(db, [], {
			now: at(now),
			send,
			sleep,
			miniAppUrl: 'https://app.test'
		});
	}

	async function runAll(now: string) {
		return runActivationNudges(db, await users(), {
			now: at(now),
			send,
			sleep,
			miniAppUrl: 'https://app.test'
		});
	}

	async function state(userId: string) {
		const [row] = await db
			.select()
			.from(activationNudges)
			.where(eq(activationNudges.userId, userId));
		return row ?? null;
	}

	it('человеку без записей — первое, с примерами под ним', async () => {
		await user('100');

		const result = await runAll('2026-09-20T10:00:00.000Z');

		expect(result.sent).toBe(1);
		expect(send).toHaveBeenCalledWith('100', FIRST_NUDGE_TEXT, expect.anything());

		const markup = send.mock.calls[0][2].replyMarkup;
		const callbacks = markup.inline_keyboard
			.flat()
			.map((b: { callback_data?: string }) => b.callback_data);
		expect(callbacks).toContain('try:0');
	});

	it('повторный вызов в тот же час ничего не дублирует', async () => {
		await user('100');

		await runAll('2026-09-20T10:00:00.000Z');
		const again = await runAll('2026-09-20T10:05:00.000Z');

		expect(again.sent).toBe(0);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('два одновременных прохода отправляют одно сообщение', async () => {
		await user('100');
		const all = await users();
		const now = at('2026-09-20T10:00:00.000Z');

		const [a, b] = await Promise.all([
			runActivationNudges(db, all, { now, send, sleep }),
			runActivationNudges(db, all, { now, send, sleep })
		]);

		expect(a.sent + b.sent).toBe(1);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('условная отметка отдаётся только один раз', async () => {
		const row = await user('100');
		const now = at('2026-09-20T10:00:00.000Z');

		expect(await claimNudge(db, row.id, 'first', now)).toBe(true);
		expect(await claimNudge(db, row.id, 'first', now)).toBe(false);
		expect(await claimNudge(db, row.id, 'second', now)).toBe(true);
	});

	it('первое и второе, а третьего не бывает', async () => {
		await user('100');

		await runAll('2026-09-20T10:00:00.000Z');
		await runAll('2026-09-22T10:00:00.000Z');
		await runAll('2026-09-22T15:00:00.000Z');
		await runAll('2026-09-23T10:00:00.000Z');

		expect(send.mock.calls.map((call) => call[1])).toEqual([FIRST_NUDGE_TEXT, SECOND_NUDGE_TEXT]);
	});

	it('после любой записи — молчит', async () => {
		const row = await user('100');
		const stamp = CONTACT;

		await createRepositories(db).finance.upsertMany(row.id, [
			{
				id: 'f1',
				createdAt: stamp,
				updatedAt: stamp,
				deletedAt: null,
				date: '2026-09-20',
				type: 'expense',
				amount: 300,
				category: 'other',
				note: 'Кофе'
			} as never
		]);

		expect(await hasAnyRecord(db, row.id)).toBe(true);
		expect((await runAll('2026-09-20T10:00:00.000Z')).sent).toBe(0);
		expect(send).not.toHaveBeenCalled();
	});

	it('удалённая и отменённая запись тоже считается', async () => {
		const row = await user('100');

		await createRepositories(db).plan.upsertMany(row.id, [
			{
				id: 'p1',
				createdAt: CONTACT,
				updatedAt: CONTACT,
				deletedAt: CONTACT,
				date: '2026-09-20',
				title: 'Зарядка',
				time: '08:00',
				kind: 'workout',
				done: false,
				note: null
			} as never
		]);

		expect(await hasAnyRecord(db, row.id)).toBe(true);
	});

	it('удалённому аккаунту не пишет', async () => {
		const row = await user('100');
		// Обезличивание — как в deleteAccountData.
		await db
			.update(usersTable)
			.set({ telegramUserId: anonymousTelegramId(row.id) })
			.where(eq(usersTable.id, row.id));

		const result = await runAll('2026-09-20T10:00:00.000Z');

		expect(result.sent).toBe(0);
		expect(send).not.toHaveBeenCalled();
	});

	it('отключённые уведомления выключают и напоминания', async () => {
		const row = await user('100');
		await createRepositories(db).planner.save({
			userId: row.id,
			schemaVersion: 1,
			settings: { notifications: { dailySummary: false } },
			updatedAt: CONTACT
		});

		expect((await runAll('2026-09-20T10:00:00.000Z')).sent).toBe(0);
	});

	it('403 — отмечает блокировку и больше не пробует', async () => {
		const row = await user('100');
		send.mockRejectedValueOnce(
			new BotApiError('sendMessage', 403, 'Forbidden: bot was blocked by the user')
		);

		const first = await runAll('2026-09-20T10:00:00.000Z');
		expect(first.blocked).toBe(1);
		expect((await state(row.id))?.blockedAt).not.toBeNull();

		const later = await runAll('2026-09-22T10:00:00.000Z');
		expect(later.sent).toBe(0);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('429 — возвращает отметку и останавливает проход', async () => {
		const a = await user('100');
		await user('200');
		send.mockRejectedValueOnce(new BotApiError('sendMessage', 429, 'Too Many Requests'));

		const result = await runAll('2026-09-20T10:00:00.000Z');

		expect(result.failed).toBe(1);
		expect(result.sent).toBe(0);
		expect(send).toHaveBeenCalledTimes(1);
		expect((await state(a.id))?.firstSentAt).toBeNull();

		// Следующий проход догоняет обоих.
		const next = await runAll('2026-09-20T11:00:00.000Z');
		expect(next.sent).toBe(2);
	});

	it('сетевая ошибка не приводит к повтору: дубль хуже потери', async () => {
		await user('100');
		send.mockRejectedValueOnce(new Error('timeout'));

		expect((await runAll('2026-09-20T10:00:00.000Z')).failed).toBe(1);
		expect((await runAll('2026-09-20T11:00:00.000Z')).sent).toBe(0);
	});

	it('между отправками держит паузу под предел Telegram', async () => {
		await user('100');
		await user('200');
		await user('300');

		await runAll('2026-09-20T10:00:00.000Z');

		expect(send).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(SEND_INTERVAL_MS);
		expect(SEND_INTERVAL_MS).toBeGreaterThanOrEqual(40);
	});

	it('пустой список — пустой итог', async () => {
		expect(await run('2026-09-20T10:00:00.000Z')).toEqual({
			sent: 0,
			skipped: 0,
			failed: 0,
			blocked: 0
		});
	});
});
