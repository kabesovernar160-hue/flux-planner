import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	parseReferralStartParam,
	REFERRAL_CAP_DAYS,
	REFERRAL_REWARD_DAYS,
	referralLink,
	referralShareUrl
} from '$lib/billing/referral';
import { activateSubscription, getSubscriptionRow } from '../billing/subscriptions';
import { createTestDb, runMigrations, type Db } from '../db/client';
import * as schema from '../db/schema';
import { financeEntries, foodEntries, habits, referrals, users } from '../db/schema';
import {
	findTelegramId,
	generateReferralCode,
	getOrCreateReferralCode,
	getReferralSummary,
	qualifyReferral,
	referralInviteeKey,
	registerReferral
} from './referrals';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SECRET = 'bot-token';

let db: Db;
let counter = 0;

async function addUser(telegramUserId = String(++counter)) {
	const id = `user-${telegramUserId}`;
	await db.insert(users).values({
		id,
		telegramUserId,
		username: null,
		firstName: null,
		timezone: 'UTC',
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString()
	});
	return { id, telegramUserId };
}

async function addFood(userId: string, deletedAt: string | null = null) {
	await db.insert(foodEntries).values({
		id: `food-${++counter}`,
		userId,
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString(),
		deletedAt,
		date: '2026-01-15',
		name: 'Овсянка',
		grams: 200,
		calories: 300,
		protein: 10,
		fat: 5,
		carbs: 50,
		source: 'manual'
	});
}

/** Новый пользователь пришёл по ссылке пригласившего. */
async function invite(inviterId: string, options: { isNewUser?: boolean } = {}) {
	const invitee = await addUser();
	const code = await getOrCreateReferralCode(db, inviterId, NOW);

	const outcome = await registerReferral(db, {
		inviteeId: invitee.id,
		inviteeKey: referralInviteeKey(invitee.telegramUserId, SECRET),
		startParam: `ref_${code}`,
		isNewUser: options.isNewUser ?? true,
		now: NOW
	});

	return { invitee, outcome, code };
}

async function expiresAt(userId: string) {
	return (await getSubscriptionRow(db, userId))?.expiresAt ?? null;
}

beforeEach(async () => {
	db = await createTestDb();
});

describe('код и ссылка', () => {
	it('код короткий, из безопасного алфавита и не повторяется', () => {
		const codes = new Set(Array.from({ length: 500 }, generateReferralCode));

		expect(codes.size).toBe(500);
		for (const code of codes) expect(code).toMatch(/^[a-z2-9]{8}$/);
	});

	it('код не раскрывает telegram id', async () => {
		const user = await addUser('1145673466');
		const code = await getOrCreateReferralCode(db, user.id, NOW);

		expect(code).not.toContain('1145673466');
		expect(referralLink(code, 'fluxplanner_xbot')).toBe(
			`https://t.me/fluxplanner_xbot/app?startapp=ref_${code}`
		);
	});

	it('у пользователя один код на все запросы', async () => {
		const user = await addUser();
		const [first, second] = await Promise.all([
			getOrCreateReferralCode(db, user.id, NOW),
			getOrCreateReferralCode(db, user.id, NOW)
		]);

		expect(second).toBe(first);
		expect(await getOrCreateReferralCode(db, user.id, NOW)).toBe(first);
	});

	it('параметр запуска разбирается строго', () => {
		expect(parseReferralStartParam('ref_abcdefgh')).toBe('abcdefgh');
		expect(parseReferralStartParam('scan')).toBeNull();
		expect(parseReferralStartParam('ref_ABCDEFGH')).toBeNull();
		expect(parseReferralStartParam('ref_abc')).toBeNull();
		expect(parseReferralStartParam("ref_abcdefgh' OR 1=1")).toBeNull();
		expect(parseReferralStartParam(null)).toBeNull();
	});

	it('окно «Поделиться» получает ссылку и текст в кодировке адреса', () => {
		const url = referralShareUrl('https://t.me/bot/app?startapp=ref_abcdefgh', 'Привет & пока');

		expect(url).toBe(
			'https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fbot%2Fapp%3Fstartapp%3Dref_abcdefgh' +
				'&text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%26%20%D0%BF%D0%BE%D0%BA%D0%B0'
		);
	});
});

describe('регистрация приглашения', () => {
	it('новый пользователь по чужой ссылке — приглашение ждёт первой записи', async () => {
		const inviter = await addUser();
		const { invitee, outcome } = await invite(inviter.id);

		expect(outcome).toBe('registered');
		const [row] = await db.select().from(referrals).where(eq(referrals.inviteeId, invitee.id));
		expect(row.status).toBe('pending');
		// Пустой аккаунт ничего не приносит: дней пока нет ни у кого.
		expect(await expiresAt(inviter.id)).toBeNull();
		expect(await expiresAt(invitee.id)).toBeNull();
	});

	it('старого пользователя пригласить нельзя', async () => {
		const inviter = await addUser();
		const { outcome } = await invite(inviter.id, { isNewUser: false });

		expect(outcome).toBe('not_new');
	});

	it('себя пригласить нельзя', async () => {
		const user = await addUser();
		const code = await getOrCreateReferralCode(db, user.id, NOW);

		const outcome = await registerReferral(db, {
			inviteeId: user.id,
			inviteeKey: referralInviteeKey(user.telegramUserId, SECRET),
			startParam: `ref_${code}`,
			isNewUser: true
		});

		expect(outcome).toBe('self');
	});

	it('чужой параметр и несуществующий код пропускаются', async () => {
		const user = await addUser();
		const base = {
			inviteeId: user.id,
			inviteeKey: referralInviteeKey(user.telegramUserId, SECRET),
			isNewUser: true
		};

		expect(await registerReferral(db, { ...base, startParam: 'scan' })).toBe('no_code');
		expect(await registerReferral(db, { ...base, startParam: 'ref_zzzzzzzz' })).toBe(
			'unknown_code'
		);
	});

	it('второй раз того же человека не пригласить — ни тем же, ни другим другом', async () => {
		const first = await addUser();
		const second = await addUser();
		const { invitee } = await invite(first.id);
		const code = await getOrCreateReferralCode(db, second.id, NOW);

		const outcome = await registerReferral(db, {
			inviteeId: invitee.id,
			inviteeKey: referralInviteeKey(invitee.telegramUserId, SECRET),
			startParam: `ref_${code}`,
			isNewUser: true
		});

		expect(outcome).toBe('already_referred');
	});

	it('удалённый и заведённый заново аккаунт того же Telegram не приглашается снова', async () => {
		const inviter = await addUser();
		const { invitee } = await invite(inviter.id);

		// После удаления вход тем же Telegram заводит нового пользователя
		// с новым id — но ключ от telegram id тот же.
		const reborn = await addUser(`reborn-${invitee.telegramUserId}`);
		const code = await getOrCreateReferralCode(db, inviter.id, NOW);

		const outcome = await registerReferral(db, {
			inviteeId: reborn.id,
			inviteeKey: referralInviteeKey(invitee.telegramUserId, SECRET),
			startParam: `ref_${code}`,
			isNewUser: true
		});

		expect(outcome).toBe('already_referred');
	});
});

describe('засчитывание', () => {
	it('без записи не засчитывается', async () => {
		const inviter = await addUser();
		const { invitee } = await invite(inviter.id);

		expect(await qualifyReferral(db, invitee.id, NOW)).toBeNull();
	});

	it('удалённая запись не считается', async () => {
		const inviter = await addUser();
		const { invitee } = await invite(inviter.id);
		await addFood(invitee.id, NOW.toISOString());

		expect(await qualifyReferral(db, invitee.id, NOW)).toBeNull();
	});

	it('первая запись приносит по 7 дней обоим', async () => {
		const inviter = await addUser();
		const { invitee } = await invite(inviter.id);
		await addFood(invitee.id);

		const result = await qualifyReferral(db, invitee.id, NOW);

		expect(result).toMatchObject({
			inviterId: inviter.id,
			inviterDays: REFERRAL_REWARD_DAYS,
			inviteeDays: REFERRAL_REWARD_DAYS
		});
		const week = new Date(NOW.getTime() + 7 * DAY).toISOString();
		expect(await expiresAt(invitee.id)).toBe(week);
		expect(await expiresAt(inviter.id)).toBe(week);
	});

	it('привычка и трата считаются записью так же, как еда', async () => {
		const inviter = await addUser();

		const { invitee: withHabit } = await invite(inviter.id);
		await db.insert(habits).values({
			id: 'habit-1',
			userId: withHabit.id,
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString(),
			deletedAt: null,
			name: 'Зарядка',
			icon: 'barbell',
			frequency: 'daily',
			targetDays: null,
			archived: false
		});

		const { invitee: withExpense } = await invite(inviter.id);
		await db.insert(financeEntries).values({
			id: 'expense-1',
			userId: withExpense.id,
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString(),
			deletedAt: null,
			date: '2026-01-15',
			type: 'expense',
			amount: 500,
			category: 'transport',
			note: null
		});

		expect(await qualifyReferral(db, withHabit.id, NOW)).not.toBeNull();
		expect(await qualifyReferral(db, withExpense.id, NOW)).not.toBeNull();
	});

	it('повторный вызов ничего не начисляет', async () => {
		const inviter = await addUser();
		const { invitee } = await invite(inviter.id);
		await addFood(invitee.id);

		await qualifyReferral(db, invitee.id, NOW);
		const before = [await expiresAt(inviter.id), await expiresAt(invitee.id)];

		expect(await qualifyReferral(db, invitee.id, NOW)).toBeNull();
		expect([await expiresAt(inviter.id), await expiresAt(invitee.id)]).toEqual(before);
	});

	it('два одновременных вызова начисляют ровно один раз', async () => {
		// Синхронизация и бот могут прислать первую запись одновременно.
		// База в памяти держит одно соединение и параллельных транзакций
		// не допускает, поэтому здесь файл — как на проде.
		const dir = mkdtempSync(join(tmpdir(), 'flux-referrals-'));
		const client = createClient({ url: `file:${join(dir, 'race.db')}` });
		db = drizzle(client, { schema });
		await runMigrations(db);

		try {
			const inviter = await addUser();
			const { invitee } = await invite(inviter.id);
			await addFood(invitee.id);

			const results = await Promise.all([
				qualifyReferral(db, invitee.id, NOW),
				qualifyReferral(db, invitee.id, NOW)
			]);

			expect(results.filter(Boolean)).toHaveLength(1);
			expect(await expiresAt(inviter.id)).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('дни продлевают платную подписку, а не перезаписывают её', async () => {
		const inviter = await addUser();
		const paidUntil = '2026-02-14T12:00:00.000Z';
		await activateSubscription(db, {
			userId: inviter.id,
			plan: 'pro',
			chargeId: 'charge-1',
			stars: 100,
			payload: 'pro',
			expiresAt: paidUntil,
			now: NOW
		});

		const { invitee } = await invite(inviter.id);
		await addFood(invitee.id);
		await qualifyReferral(db, invitee.id, NOW);

		const row = await getSubscriptionRow(db, inviter.id);
		expect(row?.expiresAt).toBe('2026-02-21T12:00:00.000Z');
		// Платная подписка осталась платной: отмена и возврат работают по ней.
		expect(row?.chargeId).toBe('charge-1');
		expect(row?.status).toBe('active');
	});

	it('пригласивший получает не больше 90 дней суммарно', async () => {
		const inviter = await addUser();
		const granted: number[] = [];

		// 13 друзей по 7 дней — 91 день, поэтому тринадцатый приносит 6,
		// а четырнадцатый — ничего.
		for (let index = 0; index < 14; index++) {
			const { invitee } = await invite(inviter.id);
			await addFood(invitee.id);
			const result = await qualifyReferral(db, invitee.id, NOW);
			granted.push(result?.inviterDays ?? -1);
		}

		expect(granted.slice(0, 12)).toEqual(Array(12).fill(REFERRAL_REWARD_DAYS));
		expect(granted[12]).toBe(REFERRAL_CAP_DAYS - 12 * REFERRAL_REWARD_DAYS);
		expect(granted[13]).toBe(0);
		expect(await expiresAt(inviter.id)).toBe(
			new Date(NOW.getTime() + REFERRAL_CAP_DAYS * DAY).toISOString()
		);

		const summary = await getReferralSummary(db, inviter.id, NOW);
		expect(summary).toMatchObject({ invited: 14, pending: 0, earnedDays: REFERRAL_CAP_DAYS });
	});

	it('приглашённый получает свои дни и когда лимит друга выбран', async () => {
		const inviter = await addUser();
		for (let index = 0; index < 13; index++) {
			const { invitee } = await invite(inviter.id);
			await addFood(invitee.id);
			await qualifyReferral(db, invitee.id, NOW);
		}

		const { invitee } = await invite(inviter.id);
		await addFood(invitee.id);
		const result = await qualifyReferral(db, invitee.id, NOW);

		expect(result?.inviterDays).toBe(0);
		expect(result?.inviterExpiresAt).toBeNull();
		expect(await expiresAt(invitee.id)).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
	});
});

describe('сводка', () => {
	it('считает засчитанных, ждущих и полученные дни', async () => {
		const inviter = await addUser();
		const { invitee } = await invite(inviter.id);
		await invite(inviter.id);
		await addFood(invitee.id);
		await qualifyReferral(db, invitee.id, NOW);

		expect(await getReferralSummary(db, inviter.id, NOW)).toMatchObject({
			invited: 1,
			pending: 1,
			earnedDays: REFERRAL_REWARD_DAYS
		});
	});

	it('обезличенному аккаунту писать некому', async () => {
		const user = await addUser();
		expect(await findTelegramId(db, user.id)).toBe(user.telegramUserId);

		await db
			.update(users)
			.set({ telegramUserId: `deleted:${user.id}` })
			.where(eq(users.id, user.id));
		expect(await findTelegramId(db, user.id)).toBeNull();
	});
});
