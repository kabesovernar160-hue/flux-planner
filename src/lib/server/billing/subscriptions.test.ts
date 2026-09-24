import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../db/client';
import { users } from '../db/schema';
import {
	activateSubscription,
	getEntitlement,
	getSubscriptionRow,
	grantProDays,
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

describe('grantProDays', () => {
	it('без подписки включает Pro на подаренные дни', async () => {
		const expiresAt = await grantProDays(db, USER_ID, 7, NOW);

		expect(expiresAt).toBe('2026-01-22T12:00:00.000Z');
		expect((await getEntitlement(db, USER_ID, NOW)).plan).toBe('pro');
		// Подарок — не платёж: журнал платежей пуст.
		expect(await listPayments(db, USER_ID)).toHaveLength(0);
	});

	it('продлевает платную подписку, не сокращая и не ломая её', async () => {
		const paid = await activateSubscription(db, payment('charge-1', '2026-02-14T12:00:00.000Z'));
		const expiresAt = await grantProDays(db, USER_ID, 7, NOW);

		expect(expiresAt).toBe('2026-02-21T12:00:00.000Z');
		expect(new Date(expiresAt).getTime()).toBeGreaterThan(new Date(paid.expiresAt).getTime());

		// Идентификатор платежа остаётся: по нему работают отмена и возврат.
		const row = await getSubscriptionRow(db, USER_ID);
		expect(row?.chargeId).toBe('charge-1');
	});

	it('автопродление звёздами не съедает подаренные дни', async () => {
		await activateSubscription(db, payment('charge-1', '2026-02-14T12:00:00.000Z'));
		await grantProDays(db, USER_ID, 7, NOW);

		// Telegram присылает свой срок следующего периода — он не знает о подарке.
		const renewal = await activateSubscription(db, {
			...payment('charge-2', '2026-03-16T12:00:00.000Z'),
			now: new Date('2026-02-14T12:00:00.000Z')
		});

		expect(renewal.expiresAt).toBe('2026-03-23T12:00:00.000Z');
	});

	it('после возврата оживляет Pro без идентификаторов старого платежа', async () => {
		await activateSubscription(db, payment('charge-1'));
		await revokeSubscription(db, 'charge-1');

		await grantProDays(db, USER_ID, 7, NOW);

		const row = await getSubscriptionRow(db, USER_ID);
		expect(row?.status).toBe('active');
		expect(row?.chargeId).toBeNull();
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
		await activateSubscription(db, payment('charge-1'));

		// Оплаченный период — 30 дней от 15 января, то есть до 14 февраля.
		const later = new Date('2026-03-01T00:00:00.000Z');
		expect((await getEntitlement(db, USER_ID, later)).plan).toBe('free');
	});
});
