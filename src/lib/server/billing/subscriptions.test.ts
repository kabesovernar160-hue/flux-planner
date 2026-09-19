import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../db/client';
import { users } from '../db/schema';
import {
	activateSubscription,
	getEntitlement,
	listPayments,
	revokeSubscription
} from './subscriptions';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const USER_ID = 'user-1';

let db: Db;

beforeEach(async () => {
	db = await createTestDb();
	await db.insert(users).values({
		id: USER_ID,
		telegramUserId: '987654',
		username: null,
		firstName: 'Тест',
		timezone: 'UTC',
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString()
	});
});

function payment(chargeId: string, expiresAt?: string) {
	return {
		userId: USER_ID,
		plan: 'pro' as const,
		chargeId,
		stars: 150,
		payload: JSON.stringify({ userId: USER_ID, plan: 'pro' }),
		expiresAt,
		now: NOW
	};
}

describe('activateSubscription', () => {
	it('включает Pro и записывает платёж', async () => {
		const result = await activateSubscription(db, payment('charge-1'));

		expect(result.applied).toBe(true);

		const entitlement = await getEntitlement(db, USER_ID, NOW);
		expect(entitlement.plan).toBe('pro');
		expect(await listPayments(db, USER_ID)).toHaveLength(1);
	});

	it('не начисляет период дважды за один платёж', async () => {
		// Telegram может доставить одно обновление повторно — второй раз
		// продлевать подписку нельзя.
		const first = await activateSubscription(db, payment('charge-1'));
		const second = await activateSubscription(db, payment('charge-1'));

		expect(second.applied).toBe(false);
		expect(second.expiresAt).toBe(first.expiresAt);
		expect(await listPayments(db, USER_ID)).toHaveLength(1);
	});

	it('доверяет сроку из Telegram, если он пришёл', async () => {
		const result = await activateSubscription(db, payment('charge-1', '2026-03-01T00:00:00.000Z'));

		expect(result.expiresAt).toBe('2026-03-01T00:00:00.000Z');
	});

	it('продление прибавляет дни к оставшемуся сроку', async () => {
		await activateSubscription(db, payment('charge-1'));
		const renewal = await activateSubscription(db, payment('charge-2'));

		// Первый период заканчивается 14 февраля, второй должен идти следом.
		expect(new Date(renewal.expiresAt).getTime()).toBeGreaterThan(
			new Date('2026-03-01T00:00:00.000Z').getTime() - 24 * 60 * 60 * 1000
		);
	});
});

describe('revokeSubscription', () => {
	it('снимает доступ после возврата', async () => {
		await activateSubscription(db, payment('charge-1'));

		expect(await revokeSubscription(db, 'charge-1')).toBe(true);

		const entitlement = await getEntitlement(db, USER_ID, NOW);
		expect(entitlement.plan).toBe('free');
		expect(entitlement.status).toBe('refunded');
	});

	it('на неизвестный платёж ничего не делает', async () => {
		expect(await revokeSubscription(db, 'нет-такого')).toBe(false);
	});

	it('оставляет платёж в журнале', async () => {
		// Финансовая история должна оставаться полной даже после возврата.
		await activateSubscription(db, payment('charge-1'));
		await revokeSubscription(db, 'charge-1');

		const history = await listPayments(db, USER_ID);
		expect(history).toHaveLength(1);
		expect(history[0].status).toBe('refunded');
	});
});

describe('getEntitlement', () => {
	it('без подписки отдаёт бесплатный тариф', async () => {
		expect((await getEntitlement(db, USER_ID, NOW)).plan).toBe('free');
	});

	it('после окончания срока возвращает на бесплатный', async () => {
		await activateSubscription(db, payment('charge-1', '2026-01-16T00:00:00.000Z'));

		const later = new Date('2026-02-01T00:00:00.000Z');
		expect((await getEntitlement(db, USER_ID, later)).plan).toBe('free');
	});
});
