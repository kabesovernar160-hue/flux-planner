import { describe, expect, it } from 'vitest';
import type { Habit, HabitCompletion, HabitFrequency } from '$lib/types/habit';
import { addDays } from './date';
import {
	calculateCurrentStreak,
	calculateDayStreak,
	calculateLongestDayStreak,
	calculateLongestStreak,
	getStreakStats,
	previousScheduledDay
} from './streak';

const TODAY = '2026-01-15'; // четверг

const habit = (overrides: Partial<Habit> = {}): Habit => ({
	id: 'h1',
	name: 'Зарядка',
	icon: 'barbell',
	frequency: 'daily' as HabitFrequency,
	createdAt: '2025-01-01T08:00:00.000Z',
	updatedAt: '2025-01-01T08:00:00.000Z',
	archived: false,
	...overrides
});

const done = (dates: string[], habitId = 'h1'): HabitCompletion[] =>
	dates.map((date, index) => ({
		id: `c${index}`,
		habitId,
		date,
		completed: true,
		createdAt: `${date}T08:00:00.000Z`,
		updatedAt: `${date}T08:00:00.000Z`
	}));

const back = (n: number) => addDays(TODAY, -n);

describe('previousScheduledDay', () => {
	it('для ежедневной привычки это вчера', () => {
		expect(previousScheduledDay(habit(), TODAY, '2020-01-01')).toBe('2026-01-14');
	});

	it('для будней понедельник идёт сразу за пятницей', () => {
		// 2026-01-12 — понедельник, предыдущий будний день — пятница 09-го.
		const weekday = habit({ frequency: 'weekdays' });
		expect(previousScheduledDay(weekday, '2026-01-12', '2020-01-01')).toBe('2026-01-09');
	});

	it('не уходит раньше дня создания привычки', () => {
		expect(previousScheduledDay(habit(), TODAY, TODAY)).toBeNull();
	});
});

describe('calculateCurrentStreak', () => {
	it('один день', () => {
		expect(calculateCurrentStreak(habit(), done([TODAY]), TODAY)).toBe(1);
	});

	it('три дня подряд', () => {
		const completions = done([TODAY, back(1), back(2)]);
		expect(calculateCurrentStreak(habit(), completions, TODAY)).toBe(3);
	});

	it('незакрытый сегодняшний день не обнуляет вчерашнюю серию', () => {
		const completions = done([back(1), back(2), back(3)]);
		expect(calculateCurrentStreak(habit(), completions, TODAY)).toBe(3);
	});

	it('пропуск в середине обрывает счёт', () => {
		// Вчера пропущено.
		const completions = done([TODAY, back(2), back(3)]);
		expect(calculateCurrentStreak(habit(), completions, TODAY)).toBe(1);
	});

	it('без отметок стрик равен нулю', () => {
		expect(calculateCurrentStreak(habit(), [], TODAY)).toBe(0);
	});

	it('будущие отметки не учитываются', () => {
		const completions = done([addDays(TODAY, 1), addDays(TODAY, 2)]);
		expect(calculateCurrentStreak(habit(), completions, TODAY)).toBe(0);
	});

	it('снятая отметка не считается выполнением', () => {
		const completions = done([TODAY, back(1)]);
		completions[0].completed = false;
		expect(calculateCurrentStreak(habit(), completions, TODAY)).toBe(1);
	});

	it('стрик не начинается раньше создания привычки', () => {
		const young = habit({ createdAt: `${back(1)}T08:00:00.000Z` });
		// Отметка за позавчера есть, но привычки тогда ещё не существовало.
		const completions = done([TODAY, back(1), back(2)]);
		expect(calculateCurrentStreak(young, completions, TODAY)).toBe(2);
	});

	describe('периодичность по будням', () => {
		const weekday = habit({ frequency: 'weekdays' });

		it('выходные не рвут серию', () => {
			// Пт 09, пн 12, вт 13, ср 14, чт 15. Суббота и воскресенье без плана.
			const completions = done(['2026-01-09', '2026-01-12', '2026-01-13', '2026-01-14', TODAY]);
			expect(calculateCurrentStreak(weekday, completions, TODAY)).toBe(5);
		});

		it('пропущенный будний день рвёт серию', () => {
			// Вторник 13-го пропущен.
			const completions = done(['2026-01-12', '2026-01-14', TODAY]);
			expect(calculateCurrentStreak(weekday, completions, TODAY)).toBe(2);
		});

		it('в выходной показывает серию с пятницы', () => {
			const saturday = '2026-01-17';
			const completions = done(['2026-01-15', '2026-01-16']);
			expect(calculateCurrentStreak(weekday, completions, saturday)).toBe(2);
		});
	});

	describe('своё расписание', () => {
		// Вторник и четверг.
		const custom = habit({ frequency: 'custom', targetDays: [2, 4] });

		it('считает только запланированные дни', () => {
			// Чт 15, вт 13, чт 08, вт 06.
			const completions = done([TODAY, '2026-01-13', '2026-01-08', '2026-01-06']);
			expect(calculateCurrentStreak(custom, completions, TODAY)).toBe(4);
		});

		it('пропуск запланированного дня рвёт серию', () => {
			// Вторник 13-го пропущен.
			const completions = done([TODAY, '2026-01-08']);
			expect(calculateCurrentStreak(custom, completions, TODAY)).toBe(1);
		});

		it('расписание без дней не даёт стрика', () => {
			const empty = habit({ frequency: 'custom', targetDays: [] });
			expect(calculateCurrentStreak(empty, done([TODAY]), TODAY)).toBe(0);
		});
	});
});

describe('calculateLongestStreak', () => {
	it('находит лучшую серию, а не последнюю', () => {
		// Серия из четырёх в прошлом, из двух — сейчас.
		const completions = done([TODAY, back(1), back(5), back(6), back(7), back(8)]);
		expect(calculateLongestStreak(habit(), completions, TODAY)).toBe(4);
		expect(calculateCurrentStreak(habit(), completions, TODAY)).toBe(2);
	});

	it('без отметок равен нулю', () => {
		expect(calculateLongestStreak(habit(), [], TODAY)).toBe(0);
	});

	it('одна отметка даёт единицу', () => {
		expect(calculateLongestStreak(habit(), done([back(30)]), TODAY)).toBe(1);
	});

	it('будущие отметки не считаются', () => {
		const completions = done([addDays(TODAY, 1), addDays(TODAY, 2), addDays(TODAY, 3)]);
		expect(calculateLongestStreak(habit(), completions, TODAY)).toBe(0);
	});
});

describe('getStreakStats', () => {
	it('собирает сводку', () => {
		const completions = done([TODAY, back(1), back(5)]);
		const stats = getStreakStats(habit(), completions, TODAY);

		expect(stats.current).toBe(2);
		expect(stats.longest).toBe(2);
		expect(stats.totalCompleted).toBe(3);
		expect(stats.lastCompletedDate).toBe(TODAY);
	});

	it('на пустой истории не падает', () => {
		const stats = getStreakStats(habit(), [], TODAY);
		expect(stats).toEqual({ current: 0, longest: 0, totalCompleted: 0, lastCompletedDate: null });
	});
});

describe('calculateDayStreak', () => {
	const a = habit({ id: 'a', name: 'A' });
	const b = habit({ id: 'b', name: 'B' });

	it('день закрыт только когда выполнены все запланированные привычки', () => {
		const completions = [...done([TODAY, back(1)], 'a'), ...done([TODAY, back(1)], 'b')];
		expect(calculateDayStreak([a, b], completions, TODAY)).toBe(2);
	});

	it('частично закрытый день не считается', () => {
		const completions = [...done([TODAY, back(1)], 'a'), ...done([back(1)], 'b')];
		// Сегодня закрыта только A — день не закрыт, серия считается со вчера.
		expect(calculateDayStreak([a, b], completions, TODAY)).toBe(1);
	});

	it('архивная привычка не мешает закрыть день', () => {
		const archived = habit({ id: 'b', archived: true });
		const completions = done([TODAY], 'a');
		expect(calculateDayStreak([a, archived], completions, TODAY)).toBe(1);
	});

	it('день без запланированных привычек не рвёт серию', () => {
		// Регрессия: выходной у привычки «по будням» считался провалом
		// и обнулял стрик каждую субботу.
		const weekday = habit({ id: 'w', frequency: 'weekdays' });
		const completions = done(
			['2026-01-15', '2026-01-14', '2026-01-13', '2026-01-12', '2026-01-09'],
			'w'
		);
		expect(calculateDayStreak([weekday], completions, TODAY)).toBe(5);
	});

	it('без привычек равен нулю', () => {
		expect(calculateDayStreak([], [], TODAY)).toBe(0);
	});
});

describe('calculateLongestDayStreak', () => {
	it('находит лучшую серию дней', () => {
		const h = habit({ createdAt: `${back(10)}T08:00:00.000Z` });
		const completions = done([back(10), back(9), back(8), back(4), back(3)]);

		expect(calculateLongestDayStreak([h], completions, TODAY)).toBe(3);
	});

	it('незакрытый сегодняшний день не обрывает текущую серию', () => {
		const h = habit({ createdAt: `${back(3)}T08:00:00.000Z` });
		const completions = done([back(3), back(2), back(1)]);

		expect(calculateLongestDayStreak([h], completions, TODAY)).toBe(3);
	});

	it('без привычек равен нулю', () => {
		expect(calculateLongestDayStreak([], [], TODAY)).toBe(0);
	});
});
