import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import {
	buildCohorts,
	buildFunnel,
	buildSources,
	buildStats,
	isTestAccount,
	normalizeSource,
	shiftDay,
	startPayload,
	testAccountSql,
	type StatsUser
} from './metrics';

describe('normalizeSource', () => {
	it('без метки — direct', () => {
		expect(normalizeSource(undefined)).toBe('direct');
		expect(normalizeSource(null)).toBe('direct');
		expect(normalizeSource('   ')).toBe('direct');
	});

	it('реферальный код сворачивается в referral: персональный код — не канал', () => {
		expect(normalizeSource('ref_abcdefgh')).toBe('referral');
		expect(normalizeSource('REF_anything')).toBe('referral');
	});

	it('короткие коды рекламы сохраняются как есть, в нижнем регистре', () => {
		expect(normalizeSource('tiktok')).toBe('tiktok');
		expect(normalizeSource('Reels')).toBe('reels');
		expect(normalizeSource('yt')).toBe('yt');
		expect(normalizeSource('tg')).toBe('tg');
		expect(normalizeSource('promo_2026')).toBe('promo_2026');
	});

	it('дефис приводится к подчёркиванию', () => {
		expect(normalizeSource('tiktok-1')).toBe('tiktok_1');
	});

	it('навигационные параметры приложения — не реклама', () => {
		expect(normalizeSource('scan')).toBe('direct');
		expect(normalizeSource('week')).toBe('direct');
	});

	it('мусор и слишком длинные метки — other', () => {
		expect(normalizeSource('a'.repeat(33))).toBe('other');
		expect(normalizeSource('привет')).toBe('other');
		expect(normalizeSource('x.y')).toBe('other');
	});

	it('параметр команды /start', () => {
		expect(startPayload('/start tiktok')).toBe('tiktok');
		expect(startPayload('/start')).toBeNull();
		expect(startPayload('/app')).toBeNull();
	});
});

describe('тестовые аккаунты', () => {
	const cases = [
		{ username: 'local_test_1', telegramUserId: '1145673466', test: true },
		{ username: 'LOCAL_TEST', telegramUserId: '1145673466', test: true },
		{ username: null, telegramUserId: '4242', test: true },
		{ username: null, telegramUserId: '1234567', test: true },
		{ username: 'anya', telegramUserId: '12345678', test: false },
		{ username: 'localXtest', telegramUserId: '1145673466', test: false },
		// Удалённый аккаунт — бывший человек, а не тест.
		{ username: null, telegramUserId: 'deleted:abc', test: false }
	];

	it('правило в коде', () => {
		for (const item of cases) expect(isTestAccount(item), JSON.stringify(item)).toBe(item.test);
	});

	it('то же правило в SQL', async () => {
		// Два описания одного правила обязаны совпадать: иначе экран
		// и скрипт насчитали бы разное число людей.
		const client = createClient({ url: 'file::memory:' });
		await client.execute('CREATE TABLE users (id TEXT, username TEXT, telegram_user_id TEXT)');
		for (const [index, item] of cases.entries()) {
			await client.execute({
				sql: 'INSERT INTO users VALUES (?, ?, ?)',
				args: [String(index), item.username, item.telegramUserId]
			});
		}

		const { rows } = await client.execute(
			`SELECT id FROM users u WHERE ${testAccountSql('u')} ORDER BY CAST(id AS INTEGER)`
		);
		const expected = cases.flatMap((item, index) => (item.test ? [String(index)] : []));

		expect(rows.map((row) => String(row.id))).toEqual(expected);

		// И дополнение: человек без ника не должен выпадать из обеих половин.
		const rest = await client.execute(
			`SELECT id FROM users u WHERE NOT ${testAccountSql('u')} ORDER BY CAST(id AS INTEGER)`
		);
		expect(rest.rows.map((row) => String(row.id))).toEqual(
			cases.flatMap((item, index) => (item.test ? [] : [String(index)]))
		);
		client.close();
	});
});

const TODAY = '2026-09-26';
const NOW = new Date(`${TODAY}T15:00:00.000Z`);

function user(joined: string, patch: Partial<StatsUser> = {}): StatsUser {
	return {
		createdAt: `${joined}T10:00:00.000Z`,
		source: 'tiktok',
		appOpenedAt: null,
		firstRecordAt: null,
		returnedD1: false,
		returnedD7: false,
		...patch
	};
}

describe('воронка', () => {
	it('считает шаги от числа пришедших', () => {
		const funnel = buildFunnel(
			[
				user('2026-09-01', { appOpenedAt: 'x', firstRecordAt: 'x', returnedD1: true }),
				user('2026-09-01', { appOpenedAt: 'x', firstRecordAt: 'x' }),
				user('2026-09-01', { appOpenedAt: 'x' }),
				user('2026-09-01')
			],
			TODAY
		);

		expect(funnel.started).toBe(4);
		expect(funnel.opened).toEqual({ count: 3, of: 4, rate: 0.75 });
		expect(funnel.activated).toEqual({ count: 2, of: 4, rate: 0.5 });
		expect(funnel.d1).toEqual({ count: 1, of: 4, rate: 0.25 });
	});

	it('возврат считается только по тем, у кого нужный день закончился', () => {
		const funnel = buildFunnel(
			[
				user(TODAY, { returnedD1: false }),
				// Вчерашние: их «завтра» — сегодня, день ещё идёт.
				user(shiftDay(TODAY, -1), { returnedD1: true }),
				user(shiftDay(TODAY, -2), { returnedD1: true }),
				user(shiftDay(TODAY, -2), { returnedD1: false }),
				user(shiftDay(TODAY, -8), { returnedD1: true, returnedD7: true })
			],
			TODAY
		);

		expect(funnel.d1).toEqual({ count: 2, of: 3, rate: 2 / 3 });
		expect(funnel.d7).toEqual({ count: 1, of: 1, rate: 1 });
	});

	it('пустой знаменатель — null, а не NaN', () => {
		const funnel = buildFunnel([], TODAY);

		expect(funnel.opened.rate).toBeNull();
		expect(funnel.d1.rate).toBeNull();
	});
});

describe('когорты', () => {
	it('ровно windowDays дней, последний — сегодня, пустые дни нулями', () => {
		const cohorts = buildCohorts([], TODAY, 30);

		expect(cohorts).toHaveLength(30);
		expect(cohorts[29].date).toBe(TODAY);
		expect(cohorts[0].date).toBe(shiftDay(TODAY, -29));
		expect(cohorts[0]).toMatchObject({ users: 0, d1: 0, d7: 0 });
	});

	it('день возврата в будущем — null, наступивший — число', () => {
		const cohorts = buildCohorts(
			[user(TODAY), user(shiftDay(TODAY, -1), { returnedD1: true })],
			TODAY,
			30
		);
		const today = cohorts[29];
		const yesterday = cohorts[28];

		expect(today).toMatchObject({ users: 1, d1: null, d7: null });
		expect(yesterday).toMatchObject({ users: 1, d1: 1, d7: null });
		expect(cohorts[22].d7).toBe(0);
		expect(cohorts[23].d7).toBeNull();
	});

	it('раскладывает людей по дню прихода и не теряет шаги', () => {
		const day = shiftDay(TODAY, -10);
		const cohorts = buildCohorts(
			[
				user(day, { appOpenedAt: 'x', firstRecordAt: 'x', returnedD1: true, returnedD7: true }),
				user(day, { appOpenedAt: 'x' }),
				// За пределами окна — в когорты не попадает.
				user(shiftDay(TODAY, -40), { appOpenedAt: 'x' })
			],
			TODAY,
			30
		);
		const cohort = cohorts.find((item) => item.date === day);

		expect(cohort).toEqual({ date: day, users: 2, opened: 2, activated: 1, d1: 1, d7: 1 });
		expect(cohorts.reduce((sum, item) => sum + item.users, 0)).toBe(2);
	});
});

describe('источники и сводка', () => {
	it('разбивка по источникам, пустой источник — direct', () => {
		const sources = buildSources(
			[
				user('2026-09-10', { source: 'tiktok', firstRecordAt: 'x' }),
				user('2026-09-10', { source: 'tiktok' }),
				user('2026-09-10', { source: null }),
				user('2026-09-10', { source: 'referral', firstRecordAt: 'x' })
			],
			TODAY
		);

		expect(sources.map((item) => [item.source, item.started])).toEqual([
			['tiktok', 2],
			['direct', 1],
			['referral', 1]
		]);
		expect(sources[0].activated.rate).toBe(0.5);
	});

	it('окно отделено от всего времени', () => {
		const stats = buildStats({
			now: NOW,
			excludedTestAccounts: 3,
			users: [user(TODAY), user(shiftDay(TODAY, -3)), user(shiftDay(TODAY, -45))],
			pro: { active: 1, paying: 0 },
			referrals: { invited: 0, qualified: 0, pending: 0, inviters: 0, daysGranted: 0 }
		});

		expect(stats.today).toBe(TODAY);
		expect(stats.totals.started).toBe(3);
		expect(stats.totals.newToday).toBe(1);
		expect(stats.totals.newLast7).toBe(2);
		expect(stats.funnel.started).toBe(2);
		expect(stats.sourcesAllTime[0].started).toBe(3);
		expect(stats.excludedTestAccounts).toBe(3);
	});
});
