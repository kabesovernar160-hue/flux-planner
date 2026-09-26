import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type Db } from '../db/client';
import { createRepositories, type Repositories } from '../db/repositories';
import { userActivity, users } from '../db/schema';
import { loadAdminStats, queryFor } from '../admin/stats';
import { recordAppVisit, resetActivityMemoForTests, trackBotStart } from './activity';

let db: Db;
let repositories: Repositories;

beforeEach(async () => {
	db = await createTestDb();
	repositories = createRepositories(db);
	resetActivityMemoForTests();
});

async function createUser(telegramUserId: string, now = '2026-09-20T10:00:00.000Z') {
	return repositories.users.upsertFromTelegram({
		id: `u-${telegramUserId}`,
		telegramUserId,
		username: 'anya',
		now
	});
}

async function row(id: string) {
	const [found] = await db.select().from(users).where(eq(users.id, id));
	return found;
}

function food(id: string, deletedAt: string | null = null) {
	return {
		id,
		createdAt: '2026-09-20T10:00:00.000Z',
		updatedAt: '2026-09-20T10:00:00.000Z',
		deletedAt,
		date: '2026-09-20',
		name: 'Борщ',
		grams: 300,
		calories: 450,
		protein: 20,
		fat: 15,
		carbs: 50,
		source: 'manual'
	};
}

describe('/start в боте', () => {
	it('заводит пользователя и пишет метку рекламы', async () => {
		await trackBotStart(123456789, { username: 'anya', first_name: 'Аня' }, '/start tiktok', {
			db
		});

		const user = await repositories.users.findByTelegramId('123456789');
		expect(user?.source).toBe('tiktok');
		expect(user?.appOpenedAt).toBeNull();
	});

	it('первое касание не перезаписывается', async () => {
		await trackBotStart(123456789, undefined, '/start tiktok', { db });
		await trackBotStart(123456789, undefined, '/start reels', { db });

		expect((await repositories.users.findByTelegramId('123456789'))?.source).toBe('tiktok');
	});

	it('без параметра — direct', async () => {
		await trackBotStart(123456789, undefined, '/start', { db });

		expect((await repositories.users.findByTelegramId('123456789'))?.source).toBe('direct');
	});
});

describe('вход в приложение', () => {
	it('первое открытие ставит отметку и источник из start_param', async () => {
		const user = await createUser('123456789');
		const now = new Date('2026-09-21T08:00:00.000Z');

		expect(await recordAppVisit(db, user, 'ref_abcdefgh', now)).toEqual({ firstOpen: true });

		const stored = await row(user.id);
		expect(stored.appOpenedAt).toBe(now.toISOString());
		expect(stored.source).toBe('referral');

		// Второй запрос — уже не первое открытие.
		expect(await recordAppVisit(db, stored, null, now)).toEqual({ firstOpen: false });
	});

	it('метка из /start остаётся, если потом открыли по другой ссылке', async () => {
		await trackBotStart(123456789, undefined, '/start yt', { db });
		const user = (await repositories.users.findByTelegramId('123456789'))!;

		const result = await recordAppVisit(db, user, 'tiktok');

		expect(result.firstOpen).toBe(true);
		expect((await row(user.id)).source).toBe('yt');
	});

	it('один день присутствия на человека и день, сколько ни заходи', async () => {
		const user = await createUser('123456789');
		const day1 = new Date('2026-09-21T08:00:00.000Z');
		const day2 = new Date('2026-09-22T08:00:00.000Z');

		await recordAppVisit(db, user, null, day1);
		await recordAppVisit(db, { ...user, appOpenedAt: 'x' }, null, day1);
		resetActivityMemoForTests();
		await recordAppVisit(db, { ...user, appOpenedAt: 'x' }, null, day1);
		await recordAppVisit(db, { ...user, appOpenedAt: 'x' }, null, day2);

		const days = await db.select().from(userActivity).where(eq(userActivity.userId, user.id));
		expect(days.map((item) => item.date).sort()).toEqual(['2026-09-21', '2026-09-22']);
	});
});

describe('первая запись', () => {
	it('ставится триггером при первой живой записи и дальше не меняется', async () => {
		const user = await createUser('123456789');

		// Надгробие записью не считается.
		await repositories.food.upsertMany(user.id, [food('f0', '2026-09-20T11:00:00.000Z')]);
		expect((await row(user.id)).firstRecordAt).toBeNull();

		await repositories.food.upsertMany(user.id, [food('f1')]);
		const first = (await row(user.id)).firstRecordAt;
		expect(first).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

		await new Promise((resolve) => setTimeout(resolve, 5));
		await repositories.food.upsertMany(user.id, [food('f2')]);
		expect((await row(user.id)).firstRecordAt).toBe(first);
	});
});

describe('сводка из базы', () => {
	it('считает воронку и не видит тестовых аккаунтов', async () => {
		const now = new Date('2026-09-26T12:00:00.000Z');
		const joined = '2026-09-20T10:00:00.000Z';

		const real = await createUser('123456789', joined);
		await createUser('223456789', joined);
		await createUser('4242', joined);
		await repositories.users.upsertFromTelegram({
			id: 'local',
			telegramUserId: '923456789',
			username: 'local_test_user',
			now: joined
		});

		await recordAppVisit(db, real, 'tiktok', new Date(joined));
		await recordAppVisit(db, { ...real, appOpenedAt: 'x' }, null, new Date('2026-09-21T09:00:00Z'));
		await repositories.food.upsertMany(real.id, [food('f1')]);

		const stats = await loadAdminStats(db, now);

		expect(stats.excludedTestAccounts).toBe(2);
		expect(stats.totals.started).toBe(2);
		expect(stats.funnel.opened.count).toBe(1);
		expect(stats.funnel.activated.count).toBe(1);
		expect(stats.funnel.d1).toMatchObject({ count: 1, of: 2 });

		const cohort = stats.cohorts.find((item) => item.date === '2026-09-20');
		expect(cohort).toMatchObject({ users: 2, opened: 1, activated: 1, d1: 1, d7: null });

		// Второй пришёл без метки и не открывал приложение: источник пуст → direct.
		expect(stats.sources.map((item) => item.source).sort()).toEqual(['direct', 'tiktok']);
	});

	it('Pro и приглашения — без тестовых', async () => {
		const now = new Date('2026-09-26T12:00:00.000Z');
		const inviter = await createUser('123456789');
		const invitee = await createUser('223456789');
		const tester = await createUser('4242');
		const query = queryFor(db);

		for (const [userId, status] of [
			[inviter.id, 'active'],
			[invitee.id, 'cancelled'],
			[tester.id, 'active']
		]) {
			await query(
				`INSERT INTO subscriptions (user_id, plan, status, expires_at, created_at, updated_at)
				 VALUES (?, 'pro', ?, '2026-10-26T00:00:00.000Z', ?, ?)`,
				[userId, status, now.toISOString(), now.toISOString()]
			);
		}
		await query(
			`INSERT INTO payments (id, user_id, charge_id, stars, payload, status, created_at)
			 VALUES ('p1', ?, 'c1', 250, 'pro', 'paid', ?)`,
			[inviter.id, now.toISOString()]
		);
		await query(
			`INSERT INTO referrals (id, inviter_id, invitee_id, invitee_key, status,
			                        invitee_days, inviter_days, created_at)
			 VALUES ('r1', ?, ?, 'k1', 'qualified', 7, 7, ?)`,
			[inviter.id, invitee.id, now.toISOString()]
		);

		const stats = await loadAdminStats(db, now);

		expect(stats.pro).toEqual({ active: 1, paying: 1 });
		expect(stats.referrals).toEqual({
			invited: 1,
			qualified: 1,
			pending: 0,
			inviters: 1,
			daysGranted: 14
		});
	});
});
