import { describe, expect, it } from 'vitest';
import { calculateExpiry, PLANS, resolveEntitlement } from './plans';

const NOW = new Date('2026-01-15T12:00:00.000Z');

describe('resolveEntitlement', () => {
	it('без подписки отдаёт бесплатный тариф', () => {
		const result = resolveEntitlement(null, NOW);

		expect(result.plan).toBe('free');
		expect(result.limits.scansPerDay).toBe(PLANS.free.limits.scansPerDay);
	});

	it('активная подписка даёт лимиты Pro', () => {
		const result = resolveEntitlement(
			{ plan: 'pro', status: 'active', expiresAt: '2026-02-01T00:00:00.000Z' },
			NOW
		);

		expect(result.plan).toBe('pro');
		expect(result.status).toBe('active');
		expect(result.limits.scansPerDay).toBe(PLANS.pro.limits.scansPerDay);
	});

	it('истёкшая подписка возвращает на бесплатный тариф', () => {
		// Статус «active» в базе сам по себе ничего не значит: платёж мог быть
		// месяц назад, и единственный надёжный признак — срок.
		const result = resolveEntitlement(
			{ plan: 'pro', status: 'active', expiresAt: '2026-01-01T00:00:00.000Z' },
			NOW
		);

		expect(result.plan).toBe('free');
		expect(result.status).toBe('expired');
	});

	it('подписка без срока не считается действующей', () => {
		const result = resolveEntitlement({ plan: 'pro', status: 'active', expiresAt: null }, NOW);

		expect(result.plan).toBe('free');
	});

	it('возврат снимает доступ немедленно', () => {
		const result = resolveEntitlement(
			{ plan: 'pro', status: 'refunded', expiresAt: '2026-02-01T00:00:00.000Z' },
			NOW
		);

		expect(result.plan).toBe('free');
		expect(result.status).toBe('refunded');
	});

	it('не верит незнакомому тарифу', () => {
		const result = resolveEntitlement(
			{ plan: 'unlimited-hacked', status: 'active', expiresAt: '2030-01-01T00:00:00.000Z' },
			NOW
		);

		expect(result.plan).toBe('free');
	});
});

describe('calculateExpiry', () => {
	it('от текущего момента, если подписки не было', () => {
		expect(calculateExpiry(null, NOW)).toBe('2026-02-14T12:00:00.000Z');
	});

	it('продлевает от конца оплаченного периода, а не с нуля', () => {
		// Оплаченные дни не должны сгорать при досрочном продлении.
		expect(calculateExpiry('2026-01-20T12:00:00.000Z', NOW)).toBe('2026-02-19T12:00:00.000Z');
	});

	it('после истечения считает заново от сегодняшнего дня', () => {
		expect(calculateExpiry('2025-12-01T12:00:00.000Z', NOW)).toBe('2026-02-14T12:00:00.000Z');
	});
});

describe('тарифы', () => {
	it('бесплатный остаётся рабочим приложением, а не демонстрацией', () => {
		expect(PLANS.free.limits.scansPerDay).toBeGreaterThan(0);
		expect(PLANS.free.limits.dataExport).toBe(true);
		expect(PLANS.free.limits.dailySummary).toBe(true);
	});

	it('у Pro честный потолок, а не обещание безлимита', () => {
		expect(Number.isFinite(PLANS.pro.limits.scansPerDay)).toBe(true);
		expect(PLANS.pro.limits.scansPerDay).toBeGreaterThan(PLANS.free.limits.scansPerDay);
	});
});
