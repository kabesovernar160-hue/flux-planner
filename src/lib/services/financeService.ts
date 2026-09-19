import { plannerStore } from '$lib/stores/plannerStore.svelte';
import {
	FINANCE_CATEGORIES,
	isCategoryFor,
	type FinanceCategory,
	type FinanceEntry,
	type FinanceEntryType
} from '$lib/types/finance';
import { isDateKey, type DateKey } from '$lib/utils/date';
import {
	calculateFinanceSummary,
	filterByDate,
	getDailySpendingSeries,
	type FinanceSummary
} from '$lib/utils/finance';
import type { ServiceResult } from './nutritionService';

/** Потолок на запись: страхует от опечатки вроде лишних трёх нулей. */
const MAX_AMOUNT = 100_000_000;
const MAX_NOTE_LENGTH = 200;

export const CATEGORY_LABELS: Record<FinanceCategory, string> = {
	food: 'Еда',
	transport: 'Транспорт',
	shopping: 'Покупки',
	entertainment: 'Развлечения',
	health: 'Здоровье',
	education: 'Образование',
	subscriptions: 'Подписки',
	other: 'Другое',

	salary: 'Зарплата',
	freelance: 'Подработка',
	bonus: 'Премия',
	gift: 'Подарок',
	refund: 'Возврат',
	investment: 'Инвестиции',
	other_income: 'Другое'
};

export type FinanceDraft = {
	type: FinanceEntryType;
	amount: number;
	category: FinanceCategory;
	note?: string;
	date?: DateKey;
};

export function validateFinanceDraft(draft: Partial<FinanceDraft>): Record<string, string> {
	const errors: Record<string, string> = {};

	if (draft.type !== 'expense' && draft.type !== 'income') {
		errors.type = 'Выберите расход или доход';
	}

	// Знак несёт поле type, а не сумма: отрицательный расход означал бы доход,
	// записанный не туда, и итоги дня разъехались бы молча.
	if (typeof draft.amount !== 'number' || !Number.isFinite(draft.amount)) {
		errors.amount = 'Введите сумму';
	} else if (draft.amount <= 0) {
		errors.amount = 'Сумма должна быть больше нуля';
	} else if (draft.amount > MAX_AMOUNT) {
		errors.amount = 'Сумма слишком большая';
	}

	if (!draft.category || !FINANCE_CATEGORIES.includes(draft.category)) {
		errors.category = 'Выберите категорию';
	} else if (draft.type && !isCategoryFor(draft.type, draft.category)) {
		// «Доход: транспорт» — запись, по которой потом ничего не посчитать.
		errors.category = 'Категория не подходит типу записи';
	}

	if (draft.note !== undefined && draft.note.length > MAX_NOTE_LENGTH) {
		errors.note = `Заметка не длиннее ${MAX_NOTE_LENGTH} символов`;
	}

	if (draft.date !== undefined && !isDateKey(draft.date)) {
		errors.date = 'Некорректная дата';
	}

	return errors;
}

/** Нейтральная категория типа: «Другое» и его аналог у доходов. */
function defaultCategoryFor(type: FinanceEntryType): FinanceCategory {
	return type === 'income' ? 'other_income' : 'other';
}

function add(draft: FinanceDraft): ServiceResult<FinanceEntry> {
	const errors = validateFinanceDraft(draft);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	const note = draft.note?.trim();

	return {
		ok: true,
		value: plannerStore.addFinanceEntry({
			type: draft.type,
			amount: draft.amount,
			category: draft.category,
			// Пустая заметка не хранится: пустая строка и её отсутствие
			// должны означать одно и то же.
			note: note ? note : undefined,
			date: draft.date
		})
	};
}

export function addExpense(draft: Omit<FinanceDraft, 'type'>): ServiceResult<FinanceEntry> {
	return add({ ...draft, type: 'expense' });
}

export function addIncome(draft: Omit<FinanceDraft, 'type'>): ServiceResult<FinanceEntry> {
	return add({ ...draft, type: 'income' });
}

export function addTransaction(draft: FinanceDraft): ServiceResult<FinanceEntry> {
	return add(draft);
}

export function updateTransaction(id: string, patch: Partial<FinanceDraft>): ServiceResult<null> {
	const existing = plannerStore.financeEntries.find((entry) => entry.id === id);
	if (!existing) return { ok: false, errors: { id: 'Запись не найдена' } };

	const type = patch.type ?? existing.type;

	/**
	 * Категория подставляется, только если её не назвали явно.
	 *
	 * Смена типа без категории — понятное намерение: трату переносят
	 * в доходы, и отказывать из-за того, что «Еда» не бывает доходом,
	 * значит ломать сценарий на ровном месте. А вот явно присланная
	 * неподходящая категория — ошибка вызывающего кода, и её надо вернуть,
	 * а не молча заменить.
	 */
	const category =
		patch.category ??
		(isCategoryFor(type, existing.category) ? existing.category : defaultCategoryFor(type));

	// Проверяется итоговое состояние записи, а не только присланные поля.
	const merged: FinanceDraft = {
		type,
		amount: patch.amount ?? existing.amount,
		category,
		note: patch.note ?? existing.note,
		date: patch.date ?? existing.date
	};

	const errors = validateFinanceDraft(merged);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	const note = merged.note?.trim();
	plannerStore.updateFinanceEntry(id, {
		type: merged.type,
		amount: merged.amount,
		category: merged.category,
		note: note ? note : undefined,
		date: merged.date
	});

	return { ok: true, value: null };
}

export function deleteTransaction(id: string): void {
	plannerStore.deleteFinanceEntry(id);
}

export function getTransactionsForDate(date: DateKey): FinanceEntry[] {
	return filterByDate(plannerStore.financeEntries, date);
}

export function getTodayExpenses(date: DateKey = plannerStore.currentDate): FinanceEntry[] {
	return getTransactionsForDate(date).filter((entry) => entry.type === 'expense');
}

export function getTodayIncome(date: DateKey = plannerStore.currentDate): FinanceEntry[] {
	return getTransactionsForDate(date).filter((entry) => entry.type === 'income');
}

export function setDailyBudget(budget: number, date?: DateKey): void {
	plannerStore.setDailyBudget(budget, date ?? plannerStore.currentDate);
}

export function getFinanceSummary(date: DateKey = plannerStore.currentDate): FinanceSummary {
	const budget = plannerStore.doc.finance[date]?.budget ?? plannerStore.doc.settings.dailyBudget;
	return calculateFinanceSummary(plannerStore.financeEntries, date, budget);
}

export function getSpendingSeries(date: DateKey = plannerStore.currentDate, days = 7): number[] {
	return getDailySpendingSeries(plannerStore.financeEntries, date, days);
}
