import type { FinanceCategory, FinanceEntry } from '$lib/types/finance';
import { addDays, type DateKey } from './date';
import { progressRatio } from './progress';

export interface FinanceSummary {
	date: DateKey;
	budget: number;
	spent: number;
	income: number;
	balance: number;
	remaining: number;
	/** Проценты. Может превышать 100 — это осмысленное превышение лимита. */
	progress: number;
	isOverBudget: boolean;
	byCategory: Partial<Record<FinanceCategory, number>>;
	topCategory: FinanceCategory | null;
	entryCount: number;
}

function amountOf(entry: FinanceEntry): number {
	return Number.isFinite(entry?.amount) ? entry.amount : 0;
}

export function filterByDate(entries: FinanceEntry[], date: DateKey): FinanceEntry[] {
	return entries.filter((entry) => entry.date === date);
}

export function calculateSpent(entries: FinanceEntry[]): number {
	return entries.reduce(
		(total, entry) => (entry.type === 'expense' ? total + amountOf(entry) : total),
		0
	);
}

export function calculateIncome(entries: FinanceEntry[]): number {
	return entries.reduce(
		(total, entry) => (entry.type === 'income' ? total + amountOf(entry) : total),
		0
	);
}

/** Доход минус расход. Отрицательное значение означает, что за день потрачено больше. */
export function calculateBalance(entries: FinanceEntry[]): number {
	return calculateIncome(entries) - calculateSpent(entries);
}

/** Остаток лимита. Отрицательный при превышении — это валидный результат. */
export function calculateBudgetRemaining(budget: number, spent: number): number {
	const safeBudget = Number.isFinite(budget) ? budget : 0;
	const safeSpent = Number.isFinite(spent) ? spent : 0;
	return safeBudget - safeSpent;
}

export function calculateBudgetProgress(spent: number, budget: number): number {
	return progressRatio(spent, budget) * 100;
}

export function groupByCategory(entries: FinanceEntry[]): Partial<Record<FinanceCategory, number>> {
	const totals: Partial<Record<FinanceCategory, number>> = {};

	for (const entry of entries) {
		if (entry.type !== 'expense') continue;
		totals[entry.category] = (totals[entry.category] ?? 0) + amountOf(entry);
	}

	return totals;
}

/** Категория с наибольшими тратами. При равенстве побеждает первая по алфавиту. */
export function topExpenseCategory(entries: FinanceEntry[]): FinanceCategory | null {
	const totals = groupByCategory(entries);
	let best: FinanceCategory | null = null;
	let bestAmount = 0;

	for (const [category, amount] of Object.entries(totals) as [FinanceCategory, number][]) {
		if (amount > bestAmount || (amount === bestAmount && best !== null && category < best)) {
			best = category;
			bestAmount = amount;
		}
	}

	return bestAmount > 0 ? best : null;
}

/**
 * Ряд трат по дням для мини-графика.
 *
 * Последний элемент — endDate. Дни без трат дают ноль, а не пропуск:
 * график должен иметь фиксированное число столбцов, иначе он «дышит»
 * при каждом изменении данных.
 */
export function getDailySpendingSeries(
	entries: FinanceEntry[],
	endDate: DateKey,
	days = 7
): number[] {
	const window = Array.from({ length: days }, (_, index) => addDays(endDate, index - (days - 1)));
	const totals = new Map<DateKey, number>(window.map((day) => [day, 0]));

	for (const entry of entries) {
		if (entry.type !== 'expense') continue;
		const current = totals.get(entry.date);
		if (current !== undefined) totals.set(entry.date, current + amountOf(entry));
	}

	return window.map((day) => totals.get(day) ?? 0);
}

export function calculateFinanceSummary(
	entries: FinanceEntry[],
	date: DateKey,
	budget: number
): FinanceSummary {
	const today = filterByDate(entries, date);
	const spent = calculateSpent(today);
	const income = calculateIncome(today);

	return {
		date,
		budget,
		spent,
		income,
		balance: income - spent,
		remaining: calculateBudgetRemaining(budget, spent),
		progress: calculateBudgetProgress(spent, budget),
		isOverBudget: spent > budget,
		byCategory: groupByCategory(today),
		topCategory: topExpenseCategory(today),
		entryCount: today.length
	};
}
