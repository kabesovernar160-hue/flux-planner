import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '$lib/db/localDb';
import { resetDriverForTests } from '$lib/db/storage';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { addDays, getToday } from '$lib/utils/date';
import {
	addExpense,
	addIncome,
	deleteTransaction,
	getFinanceSummary,
	getSpendingSeries,
	getTodayExpenses,
	getTodayIncome,
	getTransactionsForDate,
	setDailyBudget,
	updateTransaction,
	validateFinanceDraft
} from './financeService';

const draft = (overrides = {}) => ({
	type: 'expense' as const,
	amount: 920,
	category: 'food' as const,
	...overrides
});

const id = (result: ReturnType<typeof addExpense>) => (result.ok ? result.value.id : '');

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();
	await plannerStore.reset();
});

describe('validateFinanceDraft', () => {
	it('пропускает корректный черновик', () => {
		expect(validateFinanceDraft(draft())).toEqual({});
	});

	it('требует сумму больше нуля', () => {
		// Знак несёт поле type: отрицательный расход — это доход не туда.
		expect(validateFinanceDraft(draft({ amount: 0 })).amount).toBeDefined();
		expect(validateFinanceDraft(draft({ amount: -100 })).amount).toBeDefined();
	});

	it('отвергает нечисловые и бесконечные суммы', () => {
		expect(validateFinanceDraft(draft({ amount: Number.NaN })).amount).toBeDefined();
		expect(validateFinanceDraft(draft({ amount: Number.POSITIVE_INFINITY })).amount).toBeDefined();
		expect(validateFinanceDraft(draft({ amount: '920' })).amount).toBeDefined();
	});

	it('отвергает абсурдные суммы', () => {
		expect(validateFinanceDraft(draft({ amount: 1e12 })).amount).toBeDefined();
	});

	it('требует известную категорию', () => {
		expect(validateFinanceDraft(draft({ category: 'ракеты' })).category).toBeDefined();
		expect(validateFinanceDraft({ type: 'expense', amount: 100 }).category).toBeDefined();
	});

	it('требует известный тип', () => {
		expect(validateFinanceDraft(draft({ type: 'перевод' })).type).toBeDefined();
	});

	it('ограничивает длину заметки', () => {
		expect(validateFinanceDraft(draft({ note: 'а'.repeat(201) })).note).toBeDefined();
		expect(validateFinanceDraft(draft({ note: 'Такси до работы' }))).toEqual({});
	});

	it('отвергает некорректную дату', () => {
		expect(validateFinanceDraft(draft({ date: '15.01.2026' })).date).toBeDefined();
		expect(validateFinanceDraft(draft({ date: '2026-01-15' }))).toEqual({});
	});
});

describe('добавление', () => {
	it('расход попадает в итоги дня', () => {
		addExpense(draft());
		expect(plannerStore.dailySpent).toBe(920);
	});

	it('доход считается отдельно', () => {
		addIncome({ amount: 2500, category: 'salary' });

		expect(plannerStore.dailyIncome).toBe(2500);
		expect(plannerStore.dailySpent).toBe(0);
		expect(plannerStore.dailyBalance).toBe(2500);
	});

	it('пустая заметка не сохраняется', () => {
		// Пустая строка и её отсутствие должны означать одно и то же.
		const result = addExpense(draft({ note: '   ' }));
		expect(result.ok && result.value.note).toBeUndefined();
	});

	it('заметка обрезается по краям', () => {
		const result = addExpense(draft({ note: '  Такси  ' }));
		expect(result.ok && result.value.note).toBe('Такси');
	});

	it('невалидный черновик не попадает в состояние', () => {
		expect(addExpense(draft({ amount: -5 })).ok).toBe(false);
		expect(plannerStore.financeEntries).toHaveLength(0);
	});
});

describe('правка и удаление', () => {
	it('правка пересчитывает итоги', () => {
		const entryId = id(addExpense(draft()));

		expect(updateTransaction(entryId, { amount: 500 }).ok).toBe(true);
		expect(plannerStore.dailySpent).toBe(500);
	});

	it('проверяется итоговое состояние записи, а не только присланные поля', () => {
		const entryId = id(addExpense(draft()));

		expect(updateTransaction(entryId, { amount: 0 }).ok).toBe(false);
		expect(plannerStore.dailySpent).toBe(920);
	});

	it('смена типа переносит сумму из расходов в доходы', () => {
		const entryId = id(addExpense(draft()));
		updateTransaction(entryId, { type: 'income' });

		expect(plannerStore.dailySpent).toBe(0);
		expect(plannerStore.dailyIncome).toBe(920);
	});

	it('при смене типа подставляет подходящую категорию', () => {
		// «Доход: еда» — запись, по которой потом ничего не посчитать.
		const entryId = id(addExpense(draft({ category: 'food' })));
		updateTransaction(entryId, { type: 'income' });

		const entry = plannerStore.financeEntries.find((item) => item.id === entryId);
		expect(entry?.category).toBe('other_income');
	});

	it('не даёт присвоить доходу категорию расхода', () => {
		const entryId = id(addIncome({ amount: 1000, category: 'salary' }));
		const result = updateTransaction(entryId, { category: 'transport' });

		expect(result.ok).toBe(false);
	});

	it('удаление убирает запись из итогов', () => {
		const entryId = id(addExpense(draft()));
		deleteTransaction(entryId);

		expect(plannerStore.dailySpent).toBe(0);
	});

	it('правка несуществующей записи сообщает об ошибке', () => {
		expect(updateTransaction('нет-такой', { amount: 100 }).ok).toBe(false);
	});
});

describe('выборки', () => {
	it('записи фильтруются по дню', () => {
		addExpense(draft());
		addExpense(draft({ date: addDays(getToday(), -1), amount: 500 }));

		expect(getTransactionsForDate(getToday())).toHaveLength(1);
		expect(getTransactionsForDate(addDays(getToday(), -1))).toHaveLength(1);
	});

	it('расходы и доходы разделяются', () => {
		addExpense(draft());
		addIncome({ amount: 2500, category: 'salary' });

		expect(getTodayExpenses()).toHaveLength(1);
		expect(getTodayIncome()).toHaveLength(1);
	});
});

describe('бюджет и сводка', () => {
	it('лимит дня меняется', () => {
		setDailyBudget(1500);
		expect(plannerStore.todayFinance.budget).toBe(1500);
	});

	it('превышение лимита отражается в сводке', () => {
		setDailyBudget(1000);
		addExpense(draft({ amount: 1400 }));

		const summary = getFinanceSummary();

		expect(summary.isOverBudget).toBe(true);
		expect(summary.remaining).toBe(-400);
		expect(summary.progress).toBe(140);
	});

	it('на пустом дне сводка не даёт NaN', () => {
		const summary = getFinanceSummary();

		expect(summary.spent).toBe(0);
		expect(Number.isFinite(summary.progress)).toBe(true);
		expect(summary.topCategory).toBeNull();
	});

	it('сводка знает самую затратную категорию', () => {
		addExpense(draft({ amount: 300 }));
		addExpense(draft({ amount: 900, category: 'shopping' }));

		expect(getFinanceSummary().topCategory).toBe('shopping');
	});
});

describe('ряд трат для графика', () => {
	it('семь точек, последняя — сегодня', () => {
		addExpense(draft({ amount: 100, date: addDays(getToday(), -6) }));
		addExpense(draft({ amount: 200 }));

		const series = getSpendingSeries();

		expect(series).toHaveLength(7);
		expect(series[0]).toBe(100);
		expect(series[6]).toBe(200);
	});
});
