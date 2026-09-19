import type { SyncMeta } from './sync';

export type FinanceEntryType = 'expense' | 'income';

export const EXPENSE_CATEGORIES = [
	'food',
	'transport',
	'shopping',
	'entertainment',
	'health',
	'education',
	'subscriptions',
	'other'
] as const;

/**
 * Категории дохода отдельные.
 *
 * Общий список означал бы «доход: транспорт» — выбор, который ничего не
 * значит, и разбивку доходов, по которой ничего не понять.
 */
export const INCOME_CATEGORIES = [
	'salary',
	'freelance',
	'bonus',
	'gift',
	'refund',
	'investment',
	'other_income'
] as const;

/** Все категории разом — для хранения и проверок, где тип записи не важен. */
export const FINANCE_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

/** Набор категорий, подходящий типу записи. */
export function categoriesFor(type: FinanceEntryType): readonly FinanceCategory[] {
	return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

export function isCategoryFor(type: FinanceEntryType, category: unknown): boolean {
	return categoriesFor(type).includes(category as FinanceCategory);
}

export interface FinanceEntry {
	id: string;
	/** YYYY-MM-DD. */
	date: string;

	type: FinanceEntryType;

	/** Всегда положительное число. Знак несёт поле type, а не сумма. */
	amount: number;

	category: FinanceCategory;

	note?: string;

	createdAt: string;
	updatedAt: string;
	/** Надгробие. Заполнено — запись удалена и не показывается. */
	deletedAt?: string | null;
}

/**
 * Бюджет дня. Потраченное не хранится: оно выводится из FinanceEntry.
 */
export interface DailyFinance {
	date: string;
	budget: number;
}

/** Бюджет дня в хранилище: в синхронизации он ходит такой же строкой, как трата. */
export type DailyFinanceRecord = DailyFinance & SyncMeta;
