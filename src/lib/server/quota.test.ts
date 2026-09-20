import { beforeEach, describe, expect, it } from 'vitest';
import { PLANS } from '$lib/billing/plans';
import { createTestDb, type Db } from './db/client';
import { consumeScanQuota, peekScanQuota, refundScanQuota } from './quota';

let db: Db;

const USER = 'user-1';
const NOW = new Date('2026-01-15T12:00:00.000Z');

beforeEach(async () => {
	db = await createTestDb();
});

describe('consumeScanQuota', () => {
	it('пропускает, пока есть остаток бесплатного тарифа', async () => {
		for (let attempt = 0; attempt < PLANS.free.limits.scansPerDay; attempt += 1) {
			const result = await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });
			expect(result.allowed).toBe(true);
		}
	});

	it('отказывает после исчерпания и показывает нулевой остаток', async () => {
		for (let attempt = 0; attempt < PLANS.free.limits.scansPerDay; attempt += 1) {
			await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });
		}

		const result = await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });

		expect(result.allowed).toBe(false);
		expect(result.state.remaining).toBe(0);
		expect(result.state.used).toBe(result.state.limit);
	});

	it('на Pro лимит выше', async () => {
		for (let attempt = 0; attempt < PLANS.free.limits.scansPerDay + 1; attempt += 1) {
			await consumeScanQuota(USER, PLANS.pro.limits, { db, now: NOW });
		}

		const result = await consumeScanQuota(USER, PLANS.pro.limits, { db, now: NOW });
		expect(result.allowed).toBe(true);
	});

	it('считает пользователей отдельно', async () => {
		for (let attempt = 0; attempt < PLANS.free.limits.scansPerDay; attempt += 1) {
			await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });
		}

		const other = await consumeScanQuota('user-2', PLANS.free.limits, { db, now: NOW });
		expect(other.allowed).toBe(true);
	});

	it('обнуляется на следующий день', async () => {
		for (let attempt = 0; attempt < PLANS.free.limits.scansPerDay; attempt += 1) {
			await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });
		}

		const tomorrow = new Date('2026-01-16T12:00:00.000Z');
		const result = await consumeScanQuota(USER, PLANS.free.limits, { db, now: tomorrow });

		expect(result.allowed).toBe(true);
	});
});

describe('peekScanQuota', () => {
	it('не тратит попытку', async () => {
		await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });

		const first = await peekScanQuota(USER, PLANS.free.limits, { db, now: NOW });
		const second = await peekScanQuota(USER, PLANS.free.limits, { db, now: NOW });

		expect(first.used).toBe(1);
		expect(second.used).toBe(1);
	});

	it('на нетронутом счётчике показывает полный остаток', async () => {
		const state = await peekScanQuota('новый', PLANS.free.limits, { db, now: NOW });

		expect(state.remaining).toBe(PLANS.free.limits.scansPerDay);
		expect(state.used).toBe(0);
	});
});

describe('refundScanQuota', () => {
	it('возвращает попытку, если распознавание не состоялось', async () => {
		await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });
		await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });

		await refundScanQuota(USER, { db, now: NOW });

		const state = await peekScanQuota(USER, PLANS.free.limits, { db, now: NOW });
		expect(state.used).toBe(1);
		expect(state.remaining).toBe(PLANS.free.limits.scansPerDay - 1);
	});

	it('исчерпанная квота снова пускает после возврата', async () => {
		// Два сбоя провайдера подряд не должны съедать день бесплатного тарифа.
		for (let attempt = 0; attempt < PLANS.free.limits.scansPerDay; attempt += 1) {
			await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });
		}

		await refundScanQuota(USER, { db, now: NOW });

		expect((await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW })).allowed).toBe(true);
	});

	it('не уводит счётчик в минус', async () => {
		await refundScanQuota(USER, { db, now: NOW });
		await refundScanQuota(USER, { db, now: NOW });

		const state = await peekScanQuota(USER, PLANS.free.limits, { db, now: NOW });
		expect(state.used).toBe(0);
		expect(state.remaining).toBe(PLANS.free.limits.scansPerDay);
	});

	it('не трогает протухшее окно', async () => {
		// Сутки прошли, счётчик и так обнулится сам: правка там ушла бы
		// в минус уже на следующий день.
		await consumeScanQuota(USER, PLANS.free.limits, { db, now: NOW });

		const nextDay = new Date(NOW.getTime() + 36 * 60 * 60 * 1000);
		await refundScanQuota(USER, { db, now: nextDay });

		const state = await peekScanQuota(USER, PLANS.free.limits, { db, now: NOW });
		expect(state.used).toBe(1);
	});
});
