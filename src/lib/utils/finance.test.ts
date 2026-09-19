import { describe, expect, it } from 'vitest';
import type { FinanceCategory, FinanceEntry, FinanceEntryType } from '$lib/types/finance';
import { addDays } from './date';
import {
	calculateBalance,
	calculateBudgetProgress,
	calculateBudgetRemaining,
	calculateFinanceSummary,
	calculateIncome,
	calculateSpent,
	getDailySpendingSeries,
	groupByCategory,
	topExpenseCategory
} from './finance';

const TODAY = '2026-01-15';

let counter = 0;
const entry = (
	amount: number,
	category: FinanceCategory = 'food',
	type: FinanceEntryType = 'expense',
	date = TODAY
): FinanceEntry => ({
	id: `e${counter++}`,
	date,
	type,
	amount,
	category,
	createdAt: `${date}T08:00:00.000Z`,
	updatedAt: `${date}T08:00:00.000Z`
});

describe('суммы', () => {
	it('расходы и доходы считаются отдельно', () => {
		const entries = [entry(920), entry(480, 'transport'), entry(2500, 'other', 'income')];

		expect(calculateSpent(entries)).toBe(1400);
		expect(calculateIncome(entries)).toBe(2500);
		expect(calculateBalance(entries)).toBe(1100);
	});

	it('пустой список даёт нули', () => {
		expect(calculateSpent([])).toBe(0);
		expect(calculateIncome([])).toBe(0);
		expect(calculateBalance([])).toBe(0);
	});

	it('битая сумма пропускается, а не обнуляет итог', () => {
		const broken = { ...entry(100), amount: Number.NaN };
		expect(calculateSpent([entry(500), broken])).toBe(500);
	});
});

describe('бюджет', () => {
	it('остаток считается от лимита', () => {
		expect(calculateBudgetRemaining(3000, 1840)).toBe(1160);
	});

	it('при превышении остаток отрицательный — это валидный результат', () => {
		expect(calculateBudgetRemaining(1000, 1400)).toBe(-400);
	});

	it('прогресс в процентах', () => {
		expect(calculateBudgetProgress(1500, 3000)).toBe(50);
	});

	it('прогресс может превышать 100', () => {
		expect(calculateBudgetProgress(1400, 1000)).toBe(140);
	});

	it('нулевой лимит даёт 0, а не бесконечность', () => {
		expect(calculateBudgetProgress(500, 0)).toBe(0);
		expect(Number.isFinite(calculateBudgetProgress(500, 0))).toBe(true);
	});

	it('нечисловые значения не ломают расчёт', () => {
		expect(Number.isFinite(calculateBudgetRemaining(Number.NaN, 100))).toBe(true);
		expect(calculateBudgetProgress(Number.NaN, 1000)).toBe(0);
	});
});

describe('группировка по категориям', () => {
	it('суммирует расходы по категориям', () => {
		const entries = [entry(920), entry(300), entry(480, 'transport')];
		const totals = groupByCategory(entries);

		expect(totals.food).toBe(1220);
		expect(totals.transport).toBe(480);
	});

	it('доходы в группировку не попадают', () => {
		const totals = groupByCategory([entry(2500, 'other', 'income')]);
		expect(totals.other).toBeUndefined();
	});

	it('находит самую затратную категорию', () => {
		const entries = [entry(300), entry(480, 'transport'), entry(900, 'shopping')];
		expect(topExpenseCategory(entries)).toBe('shopping');
	});

	it('без расходов самой затратной категории нет', () => {
		expect(topExpenseCategory([])).toBeNull();
		expect(topExpenseCategory([entry(500, 'other', 'income')])).toBeNull();
	});
});

describe('getDailySpendingSeries', () => {
	it('отдаёт фиксированное число точек, последняя — конечный день', () => {
		const entries = [entry(100, 'food', 'expense', addDays(TODAY, -6)), entry(200)];
		const series = getDailySpendingSeries(entries, TODAY);

		expect(series).toHaveLength(7);
		expect(series[0]).toBe(100);
		expect(series[6]).toBe(200);
	});

	it('дни без трат дают ноль, а не пропуск', () => {
		// Иначе график «дышал» бы, меняя число столбцов при каждой записи.
		expect(getDailySpendingSeries([], TODAY)).toEqual([0, 0, 0, 0, 0, 0, 0]);
	});

	it('длина окна настраивается', () => {
		expect(getDailySpendingSeries([], TODAY, 14)).toHaveLength(14);
	});

	it('траты вне окна не учитываются', () => {
		const old = entry(999, 'food', 'expense', addDays(TODAY, -30));
		expect(getDailySpendingSeries([old], TODAY).every((value) => value === 0)).toBe(true);
	});

	it('доходы в ряд трат не попадают', () => {
		const series = getDailySpendingSeries([entry(5000, 'other', 'income')], TODAY);
		expect(series[6]).toBe(0);
	});
});

describe('calculateFinanceSummary', () => {
	it('собирает сводку дня', () => {
		const entries = [
			entry(920),
			entry(480, 'transport'),
			entry(440, 'subscriptions'),
			entry(2500, 'other', 'income')
		];

		const summary = calculateFinanceSummary(entries, TODAY, 3000);

		expect(summary.spent).toBe(1840);
		expect(summary.income).toBe(2500);
		expect(summary.balance).toBe(660);
		expect(summary.remaining).toBe(1160);
		expect(summary.isOverBudget).toBe(false);
		expect(summary.topCategory).toBe('food');
		expect(summary.entryCount).toBe(4);
	});

	it('помечает превышение лимита', () => {
		const summary = calculateFinanceSummary([entry(4000)], TODAY, 3000);

		expect(summary.isOverBudget).toBe(true);
		expect(summary.remaining).toBe(-1000);
		expect(summary.progress).toBeCloseTo(133.33, 1);
	});

	it('записи других дней не попадают в сводку', () => {
		const entries = [entry(500), entry(999, 'food', 'expense', addDays(TODAY, -1))];
		expect(calculateFinanceSummary(entries, TODAY, 3000).spent).toBe(500);
	});

	it('нулевой бюджет не даёт NaN', () => {
		const summary = calculateFinanceSummary([entry(500)], TODAY, 0);
		expect(summary.progress).toBe(0);
		expect(Number.isFinite(summary.remaining)).toBe(true);
	});
});
