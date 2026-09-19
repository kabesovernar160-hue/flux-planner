import { describe, expect, it } from 'vitest';
import type { FinanceCategory, FinanceEntry } from '$lib/types/finance';
import type { Habit, HabitCompletion } from '$lib/types/habit';
import type { FoodEntry } from '$lib/types/nutrition';
import {
	average,
	averageMacros,
	averageOfActive,
	caloriesByDay,
	dateRange,
	dayActivity,
	expensesByCategory,
	habitRateByDay,
	incomeByDay,
	monthGrid,
	spendingByDay,
	totalOf
} from './analytics';

const NOW = '2026-01-15T10:00:00.000Z';

function food(date: string, calories: number, extra: Partial<FoodEntry> = {}): FoodEntry {
	return {
		id: `f-${date}-${calories}`,
		date,
		name: 'Еда',
		calories,
		protein: 10,
		fat: 5,
		carbs: 20,
		source: 'manual',
		createdAt: NOW,
		updatedAt: NOW,
		...extra
	};
}

function expense(date: string, amount: number, category: FinanceCategory = 'food'): FinanceEntry {
	return {
		id: `e-${date}-${amount}`,
		date,
		type: 'expense',
		amount,
		category,
		createdAt: NOW,
		updatedAt: NOW
	} as FinanceEntry;
}

function habit(id: string, overrides: Partial<Habit> = {}): Habit {
	return {
		id,
		name: id,
		icon: 'check',
		frequency: 'daily',
		archived: false,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

function completion(habitId: string, date: string, completed = true): HabitCompletion {
	return {
		id: `${habitId}-${date}`,
		habitId,
		date,
		completed,
		createdAt: NOW,
		updatedAt: NOW
	};
}

describe('dateRange', () => {
	it('отдаёт дни по возрастанию, последний — указанный', () => {
		expect(dateRange('2026-01-15', 3)).toEqual(['2026-01-13', '2026-01-14', '2026-01-15']);
	});

	it('переходит через границу месяца', () => {
		expect(dateRange('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
	});

	it('не даёт пустого периода', () => {
		expect(dateRange('2026-01-15', 0)).toEqual(['2026-01-15']);
	});
});

describe('caloriesByDay', () => {
	const entries = [food('2026-01-14', 500), food('2026-01-14', 300), food('2026-01-15', 700)];

	it('складывает записи одного дня', () => {
		const result = caloriesByDay(entries, '2026-01-15', 2);

		expect(result).toEqual([
			{ date: '2026-01-14', value: 800 },
			{ date: '2026-01-15', value: 700 }
		]);
	});

	it('оставляет дни без записей нулями, а не выбрасывает их', () => {
		const result = caloriesByDay(entries, '2026-01-15', 4);

		expect(result).toHaveLength(4);
		expect(result[0]).toEqual({ date: '2026-01-12', value: 0 });
	});
});

describe('spendingByDay', () => {
	it('считает только расходы', () => {
		const income = { ...expense('2026-01-15', 1000), type: 'income' } as FinanceEntry;
		const result = spendingByDay([expense('2026-01-15', 300), income], '2026-01-15', 1);

		expect(result[0].value).toBe(300);
	});
});

describe('incomeByDay', () => {
	it('считает только доходы', () => {
		const income = {
			...expense('2026-01-15', 5000, 'salary'),
			type: 'income'
		} as FinanceEntry;

		const result = incomeByDay([income, expense('2026-01-15', 300)], '2026-01-15', 1);

		expect(result[0].value).toBe(5000);
	});

	it('дни без дохода оставляет нулями', () => {
		expect(incomeByDay([], '2026-01-15', 3).map((day) => day.value)).toEqual([0, 0, 0]);
	});
});

describe('habitRateByDay', () => {
	it('считает долю от запланированных на день', () => {
		const habits = [habit('a'), habit('b')];
		const completions = [completion('a', '2026-01-15')];

		expect(habitRateByDay(habits, completions, '2026-01-15', 1)[0].value).toBe(0.5);
	});

	it('не считает привычку выполненной по снятой отметке', () => {
		const completions = [completion('a', '2026-01-15', false)];

		expect(habitRateByDay([habit('a')], completions, '2026-01-15', 1)[0].value).toBe(0);
	});

	it('игнорирует удалённые отметки', () => {
		const removed = { ...completion('a', '2026-01-15'), deletedAt: NOW };

		expect(habitRateByDay([habit('a')], [removed], '2026-01-15', 1)[0].value).toBe(0);
	});

	it('день без плана не считает проваленным', () => {
		// 17 января 2026 — суббота: у привычки «по будням» плана нет.
		const weekday = habit('a', { frequency: 'weekdays' });

		expect(habitRateByDay([weekday], [], '2026-01-17', 1)[0].value).toBe(0);
	});
});

describe('средние', () => {
	const days = [
		{ date: '2026-01-13', value: 0 },
		{ date: '2026-01-14', value: 2000 },
		{ date: '2026-01-15', value: 1000 }
	];

	it('average делит на все дни', () => {
		expect(average(days)).toBe(1000);
	});

	it('averageOfActive пропускает дни без записей', () => {
		// Пропущенные дни не должны изображать дефицит, которого не было.
		expect(averageOfActive(days)).toBe(1500);
	});

	it('на пустом периоде не делит на ноль', () => {
		expect(average([])).toBe(0);
		expect(averageOfActive([])).toBe(0);
		expect(totalOf([])).toBe(0);
	});
});

describe('expensesByCategory', () => {
	it('группирует и считает доли', () => {
		const result = expensesByCategory(
			[
				expense('2026-01-15', 300, 'food'),
				expense('2026-01-14', 100, 'food'),
				expense('2026-01-15', 100, 'transport')
			],
			'2026-01-15',
			7
		);

		expect(result[0]).toEqual({ category: 'food', amount: 400, share: 0.8 });
		expect(result[1].category).toBe('transport');
	});

	it('не берёт траты за пределами периода', () => {
		const result = expensesByCategory([expense('2026-01-01', 500)], '2026-01-15', 7);

		expect(result).toEqual([]);
	});
});

describe('averageMacros', () => {
	it('делит на дни с записями, а не на весь период', () => {
		const result = averageMacros([food('2026-01-15', 500)], '2026-01-15', 7);

		expect(result.protein).toBe(10);
		expect(result.carbs).toBe(20);
	});

	it('на пустом наборе даёт нули', () => {
		expect(averageMacros([], '2026-01-15', 7)).toEqual({ protein: 0, fat: 0, carbs: 0 });
	});
});

describe('dayActivity', () => {
	it('собирает сводку дня за один проход', () => {
		const result = dayActivity('2026-01-15', {
			foodEntries: [food('2026-01-15', 600), food('2026-01-14', 100)],
			financeEntries: [expense('2026-01-15', 250)],
			habits: [habit('a'), habit('b')],
			completions: [completion('a', '2026-01-15')]
		});

		expect(result).toMatchObject({
			calories: 600,
			spent: 250,
			habitsDone: 1,
			habitsPlanned: 2,
			hasAnything: true
		});
	});

	it('пустой день помечает как пустой', () => {
		const result = dayActivity('2026-01-10', {
			foodEntries: [],
			financeEntries: [],
			habits: [habit('a')],
			completions: []
		});

		expect(result.hasAnything).toBe(false);
	});
});

describe('monthGrid', () => {
	it('отдаёт прямоугольную сетку с понедельника', () => {
		const cells = monthGrid('2026-01-15');

		expect(cells.length % 7).toBe(0);
		expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31);
		// 1 января 2026 — четверг, значит перед ним три дня декабря.
		expect(cells[0].date).toBe('2025-12-29');
		expect(cells[3].date).toBe('2026-01-01');
	});

	it('работает в феврале високосного года', () => {
		const cells = monthGrid('2024-02-10');

		expect(cells.filter((cell) => cell.inMonth)).toHaveLength(29);
		expect(cells.length % 7).toBe(0);
	});
});
