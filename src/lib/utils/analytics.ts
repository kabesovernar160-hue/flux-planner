import type { FinanceCategory, FinanceEntry } from '$lib/types/finance';
import type { Habit, HabitCompletion } from '$lib/types/habit';
import type { FoodEntry } from '$lib/types/nutrition';
import type { PlanItem } from '$lib/types/plan';
import { addDays, type DateKey } from './date';
import { scheduledHabits } from './habitFrequency';

/**
 * Агрегаты за период.
 *
 * Чистые функции без стора: их гоняют тесты, а экран аналитики только рисует
 * то, что они вернули. Считать прямо в компоненте значило бы, что проверить
 * цифры можно лишь глазами по скриншоту.
 */

export interface DayValue {
	date: DateKey;
	value: number;
}

/** Дни периода по возрастанию, последний — `end`. */
export function dateRange(end: DateKey, days: number): DateKey[] {
	const safeDays = Math.max(1, Math.floor(days));
	return Array.from({ length: safeDays }, (_, index) => addDays(end, index - safeDays + 1));
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
	return items.reduce((total, item) => {
		const value = pick(item);
		return total + (Number.isFinite(value) ? value : 0);
	}, 0);
}

/**
 * Калории по дням.
 *
 * Дни без записей остаются нулями, а не выпадают из ряда: пропуск в графике
 * читался бы как «данных нет», хотя на деле человек просто ничего не ел
 * или не записал.
 */
export function caloriesByDay(entries: FoodEntry[], end: DateKey, days: number): DayValue[] {
	return dateRange(end, days).map((date) => ({
		date,
		value: sumBy(
			entries.filter((entry) => entry.date === date),
			(entry) => entry.calories
		)
	}));
}

export function spendingByDay(entries: FinanceEntry[], end: DateKey, days: number): DayValue[] {
	return dateRange(end, days).map((date) => ({
		date,
		value: sumBy(
			entries.filter((entry) => entry.date === date && entry.type === 'expense'),
			(entry) => entry.amount
		)
	}));
}

/** Доходы по дням. Зеркало spendingByDay: знак несёт тип записи, не сумма. */
export function incomeByDay(entries: FinanceEntry[], end: DateKey, days: number): DayValue[] {
	return dateRange(end, days).map((date) => ({
		date,
		value: sumBy(
			entries.filter((entry) => entry.date === date && entry.type === 'income'),
			(entry) => entry.amount
		)
	}));
}

/**
 * Доля выполненных привычек по дням, 0…1.
 *
 * Знаменатель — привычки, запланированные именно на этот день: у «по будням»
 * в субботу плана нет, и такой день не должен выглядеть проваленным.
 * Дни без плана отдают ноль, но помечаются через planned = 0 в daySummary.
 */
export function habitRateByDay(
	habits: Habit[],
	completions: HabitCompletion[],
	end: DateKey,
	days: number
): DayValue[] {
	return dateRange(end, days).map((date) => {
		const planned = scheduledHabits(habits, date);
		if (planned.length === 0) return { date, value: 0 };

		const done = planned.filter((habit) =>
			completions.some(
				(completion) =>
					completion.habitId === habit.id &&
					completion.date === date &&
					completion.completed &&
					!completion.deletedAt
			)
		).length;

		return { date, value: done / planned.length };
	});
}

/** Среднее по дням. Пустой период — ноль, а не деление на ноль. */
export function average(values: DayValue[]): number {
	if (values.length === 0) return 0;
	return sumBy(values, (day) => day.value) / values.length;
}

/**
 * Среднее только по дням с записями.
 *
 * Для калорий это честнее общего среднего: три дня без записей утянули бы
 * «в среднем за неделю» вниз и показали бы дефицит, которого не было.
 */
export function averageOfActive(values: DayValue[]): number {
	const active = values.filter((day) => day.value > 0);
	if (active.length === 0) return 0;
	return sumBy(active, (day) => day.value) / active.length;
}

export function totalOf(values: DayValue[]): number {
	return sumBy(values, (day) => day.value);
}

export interface CategoryTotal {
	category: FinanceCategory;
	amount: number;
	/** Доля от всех трат периода, 0…1. */
	share: number;
}

/** Траты по категориям за период, по убыванию суммы. */
export function expensesByCategory(
	entries: FinanceEntry[],
	end: DateKey,
	days: number
): CategoryTotal[] {
	const period = new Set(dateRange(end, days));
	const totals = new Map<FinanceCategory, number>();

	for (const entry of entries) {
		if (entry.type !== 'expense' || !period.has(entry.date)) continue;
		if (!Number.isFinite(entry.amount)) continue;
		totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.amount);
	}

	const total = [...totals.values()].reduce((sum, value) => sum + value, 0);

	return [...totals.entries()]
		.map(([category, amount]) => ({
			category,
			amount,
			share: total > 0 ? amount / total : 0
		}))
		.sort((a, b) => b.amount - a.amount);
}

export interface MacroAverages {
	protein: number;
	fat: number;
	carbs: number;
}

/** Средние макросы по дням с записями. */
export function averageMacros(entries: FoodEntry[], end: DateKey, days: number): MacroAverages {
	const period = dateRange(end, days);
	const active = period.filter((date) => entries.some((entry) => entry.date === date));
	if (active.length === 0) return { protein: 0, fat: 0, carbs: 0 };

	const inPeriod = entries.filter((entry) => active.includes(entry.date));

	return {
		protein: sumBy(inPeriod, (entry) => entry.protein) / active.length,
		fat: sumBy(inPeriod, (entry) => entry.fat) / active.length,
		carbs: sumBy(inPeriod, (entry) => entry.carbs) / active.length
	};
}

export interface DayActivity {
	date: DateKey;
	calories: number;
	spent: number;
	/** Сколько привычек закрыто и сколько было запланировано. */
	habitsDone: number;
	habitsPlanned: number;
	/** Пункты плана на этот день: выполнено и всего. */
	planDone: number;
	planTotal: number;
	hasAnything: boolean;
}

/**
 * Сводка дня для календаря.
 *
 * Один проход вместо трёх отдельных выборок на каждую ячейку месяца:
 * тридцать дней × три фильтра по всем записям — это заметная работа
 * на каждый перерисованный кадр в WebView.
 */
export function dayActivity(
	date: DateKey,
	data: {
		foodEntries: FoodEntry[];
		financeEntries: FinanceEntry[];
		habits: Habit[];
		completions: HabitCompletion[];
		planItems?: PlanItem[];
	}
): DayActivity {
	const calories = sumBy(
		data.foodEntries.filter((entry) => entry.date === date),
		(entry) => entry.calories
	);

	const spent = sumBy(
		data.financeEntries.filter((entry) => entry.date === date && entry.type === 'expense'),
		(entry) => entry.amount
	);

	const planned = scheduledHabits(data.habits, date);
	const habitsDone = planned.filter((habit) =>
		data.completions.some(
			(completion) =>
				completion.habitId === habit.id &&
				completion.date === date &&
				completion.completed &&
				!completion.deletedAt
		)
	).length;

	const plan = (data.planItems ?? []).filter((item) => item.date === date && !item.deletedAt);
	const planDone = plan.filter((item) => item.done).length;

	return {
		date,
		calories,
		spent,
		habitsDone,
		habitsPlanned: planned.length,
		planDone,
		planTotal: plan.length,
		hasAnything: calories > 0 || spent > 0 || habitsDone > 0 || plan.length > 0
	};
}

/**
 * Сетка месяца, начинающаяся с понедельника.
 *
 * Дни соседних месяцев добиваются в начало и конец, чтобы сетка всегда была
 * прямоугольной: «рваная» первая строка ломает выравнивание по дням недели.
 */
export function monthGrid(anchor: DateKey): { date: DateKey; inMonth: boolean }[] {
	const [year, month] = anchor.split('-').map(Number);
	const first = new Date(Date.UTC(year, month - 1, 1));
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

	// getUTCDay(): 0 — воскресенье. Неделя начинается с понедельника,
	// поэтому воскресенье уезжает в конец.
	const leading = (first.getUTCDay() + 6) % 7;

	const pad = (value: number) => String(value).padStart(2, '0');
	const key = (date: Date) =>
		`${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

	const cells: { date: DateKey; inMonth: boolean }[] = [];

	for (let index = leading; index > 0; index -= 1) {
		cells.push({ date: key(new Date(Date.UTC(year, month - 1, 1 - index))), inMonth: false });
	}

	for (let day = 1; day <= daysInMonth; day += 1) {
		cells.push({ date: key(new Date(Date.UTC(year, month - 1, day))), inMonth: true });
	}

	while (cells.length % 7 !== 0) {
		const next = cells.length - leading - daysInMonth + 1;
		cells.push({ date: key(new Date(Date.UTC(year, month, next))), inMonth: false });
	}

	return cells;
}
