import { describe, expect, it } from 'vitest';
import type { FinanceEntry } from '$lib/types/finance';
import type { Habit, HabitCompletion } from '$lib/types/habit';
import type { FoodEntry } from '$lib/types/nutrition';
import type { PlanItem } from '$lib/types/plan';
import type { WeightEntry } from '$lib/types/weight';
import {
	buildWeekReport,
	compareWeeks,
	formatChange,
	weekAdvice,
	weekBotLines,
	weekdayName,
	weekInsights,
	weekLabel,
	weekShareText,
	weekStartOf,
	type WeekData
} from './weekly';

const MON = '2026-09-21';
const PREV_MON = '2026-09-14';
const STAMP = '2026-09-21T08:00:00.000Z';

let seq = 0;
const id = () => `id-${++seq}`;

function food(date: string, calories: number): FoodEntry {
	return {
		id: id(),
		date,
		name: 'Еда',
		calories,
		protein: 0,
		fat: 0,
		carbs: 0,
		source: 'manual',
		createdAt: STAMP,
		updatedAt: STAMP
	};
}

function expense(
	date: string,
	amount: number,
	category: FinanceEntry['category'] = 'food'
): FinanceEntry {
	return {
		id: id(),
		date,
		type: 'expense',
		amount,
		category,
		createdAt: STAMP,
		updatedAt: STAMP
	} as FinanceEntry;
}

function habit(name: string): Habit {
	return {
		id: name,
		name,
		icon: 'check',
		frequency: 'daily',
		archived: false,
		createdAt: '2026-09-01T08:00:00.000Z',
		updatedAt: STAMP
	} as Habit;
}

function done(habitId: string, date: string): HabitCompletion {
	return {
		id: id(),
		habitId,
		date,
		completed: true,
		createdAt: STAMP,
		updatedAt: STAMP
	} as HabitCompletion;
}

function planItem(date: string, isDone: boolean): PlanItem {
	return {
		id: id(),
		date,
		title: 'Дело',
		kind: 'task',
		done: isDone,
		createdAt: STAMP,
		updatedAt: STAMP
	};
}

function weight(date: string, weightKg: number): WeightEntry {
	return { id: id(), date, weightKg, createdAt: STAMP, updatedAt: STAMP };
}

function data(overrides: Partial<WeekData> = {}): WeekData {
	return {
		foodEntries: [],
		habits: [],
		completions: [],
		financeEntries: [],
		planItems: [],
		weightEntries: [],
		defaultCalorieGoal: 2000,
		defaultBudget: 1000,
		...overrides
	};
}

const days = (start: string) =>
	Array.from({ length: 7 }, (_, index) => {
		const [y, m, d] = start.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, d + index)).toISOString().slice(0, 10);
	});

describe('границы недели', () => {
	it('неделя начинается с понедельника, воскресенье — её последний день', () => {
		expect(weekStartOf('2026-09-24')).toBe(MON); // четверг
		expect(weekStartOf('2026-09-27')).toBe(MON); // воскресенье
		expect(weekStartOf(MON)).toBe(MON);
		expect(weekdayName('2026-09-23')).toBe('среда');
	});

	it('подпись недели по-русски, в том числе через границу месяца', () => {
		expect(weekLabel(MON)).toBe('21–27 сентября');
		expect(weekLabel('2026-09-28')).toBe('28 сентября — 4 октября');
	});
});

describe('сводка недели', () => {
	it('пустая неделя так и называется, без нулевых средних', () => {
		const report = buildWeekReport(data(), MON);

		expect(report.isEmpty).toBe(true);
		expect(report.activeDays).toBe(0);
		expect(report.habits.rate).toBeNull();
		expect(report.weight.change).toBeNull();
	});

	it('калории: среднее по дням с записями и дни в коридоре ±10 %', () => {
		const report = buildWeekReport(
			data({
				foodEntries: [
					food('2026-09-21', 2000), // в цели
					food('2026-09-22', 1850), // в цели (−7,5 %)
					food('2026-09-23', 2500), // перебор
					food('2026-09-24', 600), // один завтрак — не в цели
					food('2026-09-10', 3000) // чужая неделя
				]
			}),
			MON
		);

		expect(report.nutrition.trackedDays).toBe(4);
		expect(report.nutrition.avgCalories).toBe((2000 + 1850 + 2500 + 600) / 4);
		expect(report.nutrition.inGoalDays).toBe(2);
	});

	it('цель дня берётся из записи дня, если она есть', () => {
		const report = buildWeekReport(
			data({ foodEntries: [food('2026-09-21', 1600)], calorieGoals: { '2026-09-21': 1600 } }),
			MON
		);

		expect(report.days[0].inGoal).toBe(true);
	});

	it('привычки: доля закрытых и самая длинная серия внутри недели', () => {
		const water = habit('Вода');
		const completions = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-25', '2026-09-26'].map(
			(date) => done(water.id, date)
		);

		const report = buildWeekReport(data({ habits: [water], completions }), MON);

		expect(report.habits.planned).toBe(7);
		expect(report.habits.done).toBe(5);
		expect(report.habits.rate).toBeCloseTo(5 / 7);
		expect(report.habits.bestStreak).toBe(3);
	});

	it('в текущей неделе будущие дни не входят в план привычек и в лимит', () => {
		const water = habit('Вода');
		const report = buildWeekReport(
			data({ habits: [water], completions: [done(water.id, '2026-09-21')] }),
			MON,
			'2026-09-24'
		);

		expect(report.habits.planned).toBe(4);
		expect(report.finance.budget).toBe(4000);
		expect(report.finance.dailyBudget).toBe(1000);
	});

	it('удалённые записи и снятые отметки не считаются', () => {
		const water = habit('Вода');
		const report = buildWeekReport(
			data({
				habits: [water],
				foodEntries: [{ ...food('2026-09-21', 2000), deletedAt: STAMP }],
				completions: [{ ...done(water.id, '2026-09-21'), completed: false }]
			}),
			MON
		);

		expect(report.nutrition.trackedDays).toBe(0);
		expect(report.habits.done).toBe(0);
	});

	it('траты: сумма, лимит недели, дни сверх лимита и категории', () => {
		const report = buildWeekReport(
			data({
				financeEntries: [
					expense('2026-09-21', 1500, 'food'),
					expense('2026-09-22', 400, 'transport'),
					expense('2026-09-23', 1200, 'food'),
					{ ...expense('2026-09-23', 50000), type: 'income', category: 'salary' }
				]
			}),
			MON
		);

		expect(report.finance.spent).toBe(3100);
		expect(report.finance.budget).toBe(7000);
		expect(report.finance.overBudgetDays).toBe(2);
		expect(report.finance.byCategory[0]).toEqual({ category: 'food', amount: 2700 });
	});

	it('план и вес: выполненные дела и изменение от последнего взвешивания до недели', () => {
		const report = buildWeekReport(
			data({
				planItems: [planItem('2026-09-21', true), planItem('2026-09-22', false)],
				weightEntries: [
					weight('2026-09-15', 80.4),
					weight('2026-09-22', 80.1),
					weight('2026-09-27', 79.8)
				]
			}),
			MON
		);

		expect(report.plan).toEqual({ done: 1, total: 2 });
		expect(report.weight).toEqual({ from: 80.4, to: 79.8, change: -0.6 });
	});

	it('одно взвешивание без прошлого — ещё не изменение', () => {
		const report = buildWeekReport(data({ weightEntries: [weight('2026-09-22', 80)] }), MON);

		expect(report.weight.change).toBeNull();
		expect(report.isEmpty).toBe(false);
	});
});

describe('сравнение с прошлой неделей', () => {
	it('стрелки и проценты', () => {
		const current = buildWeekReport(data({ foodEntries: [food('2026-09-21', 1800)] }), MON);
		const previous = buildWeekReport(data({ foodEntries: [food('2026-09-14', 2000)] }), PREV_MON);

		const comparison = compareWeeks(current, previous);

		expect(comparison.calories).toBeCloseTo(-0.1);
		expect(formatChange(comparison.calories)).toEqual({ arrow: '↓', text: '10 %' });
		expect(formatChange(0.25)).toEqual({ arrow: '↑', text: '25 %' });
		expect(formatChange(0.01)).toEqual({ arrow: '→', text: 'столько же' });
		// От нуля процент не считается.
		expect(
			formatChange(compareWeeks(current, buildWeekReport(data(), PREV_MON)).calories)
		).toBeNull();
	});
});

describe('выводы', () => {
	it('называет лучший день и объясняет почему', () => {
		const water = habit('Вода');
		const report = buildWeekReport(
			data({
				habits: [water],
				completions: [done(water.id, '2026-09-23')],
				foodEntries: [food('2026-09-23', 2000), food('2026-09-24', 3000)]
			}),
			MON
		);

		expect(weekInsights(report, null)[0]).toBe(
			'Лучший день — среда: все привычки закрыты и калории в цели.'
		);
	});

	it('замечает заметное изменение трат по категории', () => {
		const previous = buildWeekReport(
			data({
				financeEntries: [
					expense('2026-09-14', 5000, 'food'),
					expense('2026-09-15', 1000, 'transport')
				]
			}),
			PREV_MON
		);
		const current = buildWeekReport(
			data({
				financeEntries: [
					expense('2026-09-21', 4100, 'food'),
					expense('2026-09-22', 1000, 'transport')
				]
			}),
			MON
		);

		expect(weekInsights(current, previous)).toContain('Траты на еду −18 % к прошлой неделе.');
	});

	it('выводов не больше двух', () => {
		const water = habit('Вода');
		const report = buildWeekReport(
			data({
				habits: [water],
				completions: days(MON).map((date) => done(water.id, date)),
				foodEntries: [food('2026-09-21', 2000), food('2026-09-22', 3000)]
			}),
			MON
		);

		expect(weekInsights(report, null).length).toBeLessThanOrEqual(2);
	});
});

describe('совет на следующую неделю', () => {
	it('для пустой недели — начать с одной записи', () => {
		expect(weekAdvice(buildWeekReport(data(), MON))).toMatch(/одной записи/);
	});

	it('мало дней с едой — сначала про регулярность', () => {
		const report = buildWeekReport(data({ foodEntries: [food('2026-09-21', 2000)] }), MON);
		expect(weekAdvice(report)).toMatch(/4 дня из 7/);
	});

	it('всё ровно — похвала и маленький шаг', () => {
		const water = habit('Вода');
		const report = buildWeekReport(
			data({
				habits: [water],
				completions: days(MON).map((date) => done(water.id, date)),
				foodEntries: days(MON).map((date) => food(date, 2000))
			}),
			MON
		);
		expect(weekAdvice(report)).toMatch(/ровная/);
	});
});

describe('тексты наружу', () => {
	const water = habit('Вода');
	const report = buildWeekReport(
		data({
			habits: [water],
			completions: days(MON)
				.slice(0, 6)
				.map((date) => done(water.id, date)),
			foodEntries: [food('2026-09-21', 2000), food('2026-09-22', 2600)],
			financeEntries: [expense('2026-09-21', 12345)]
		}),
		MON
	);

	it('«Поделиться» — только проценты и серии, без калорий и денег', () => {
		const text = weekShareText(report);

		expect(text).toContain('привычки — 86 %');
		expect(text).toContain('серия 6 дней');
		expect(text).toContain('калории в цели — 50 % дней');
		expect(text).not.toMatch(/12\s?345|2\s?600|ккал|₽/);
	});

	it('бот — ровно три строки', () => {
		const lines = weekBotLines(report, null, (value) => `${value} ₽`);

		expect(lines).toEqual([
			'Привычки: 86 % · серия 6 дней',
			'Калории в цели 1 из 2 дней',
			'Траты: 12345 ₽ из 7000 ₽'
		]);
	});
});
