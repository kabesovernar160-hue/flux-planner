import { describe, expect, it } from 'vitest';
import type { FinanceEntry } from '$lib/types/finance';
import { frequentFinance } from './financeHistory';

const entry = (overrides: Partial<FinanceEntry> & { date: string }): FinanceEntry => ({
	id: `${overrides.date}-${overrides.note ?? overrides.category ?? 'x'}`,
	type: 'expense',
	amount: 300,
	category: 'food',
	createdAt: `${overrides.date}T08:00:00.000Z`,
	updatedAt: `${overrides.date}T08:00:00.000Z`,
	...overrides
});

describe('frequentFinance', () => {
	it('чаще повторяемое идёт выше', () => {
		const result = frequentFinance(
			[
				entry({ date: '2026-01-13', note: 'Кофе' }),
				entry({ date: '2026-01-14', note: 'Кофе' }),
				entry({ date: '2026-01-14', note: 'Метро', category: 'transport', amount: 60 })
			],
			{ end: '2026-01-15' }
		);

		expect(result.map((item) => item.note)).toEqual(['Кофе', 'Метро']);
		expect(result[0].count).toBe(2);
	});

	it('сумма берётся из последней записи', () => {
		// Кофе дорожает, и подставлять прошлогоднюю цену значит заставлять
		// править её каждый раз.
		const result = frequentFinance(
			[
				entry({ date: '2026-01-05', note: 'Кофе', amount: 250 }),
				entry({ date: '2026-01-14', note: 'Кофе', amount: 320 })
			],
			{ end: '2026-01-15' }
		);

		expect(result[0].amount).toBe(320);
	});

	it('разделяет по категории и заметке', () => {
		const result = frequentFinance(
			[entry({ date: '2026-01-14', note: 'Кофе' }), entry({ date: '2026-01-14', note: 'Обед' })],
			{ end: '2026-01-15' }
		);

		expect(result).toHaveLength(2);
	});

	it('доходы и расходы не смешиваются', () => {
		const result = frequentFinance(
			[
				entry({ date: '2026-01-14', note: 'Кофе' }),
				entry({ date: '2026-01-14', note: 'Зарплата', type: 'income', category: 'salary' })
			],
			{ end: '2026-01-15', type: 'income' }
		);

		expect(result.map((item) => item.note)).toEqual(['Зарплата']);
	});

	it('за пределы периода не выходит', () => {
		const result = frequentFinance(
			[entry({ date: '2025-11-01', note: 'Старое' }), entry({ date: '2026-01-14', note: 'Кофе' })],
			{ end: '2026-01-15', days: 30 }
		);

		expect(result.map((item) => item.note)).toEqual(['Кофе']);
	});

	it('на пустой истории отдаёт пустой список', () => {
		expect(frequentFinance([], { end: '2026-01-15' })).toEqual([]);
	});
});
