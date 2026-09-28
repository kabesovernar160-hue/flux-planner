import { describe, expect, it } from 'vitest';
import type { Habit, HabitCompletion } from '$lib/types/habit';
import { groupHabitsForDay, habitWeekHistory, weekScore } from './habitWeek';

// 2026-01-15 — четверг; неделя назад от него — пятница 9-го … четверг 15-го.
const TODAY = '2026-01-15';

const habit = (overrides: Partial<Habit> = {}): Habit => ({
	id: 'h1',
	name: 'Зарядка',
	icon: 'barbell',
	frequency: 'daily',
	createdAt: '2025-01-01T08:00:00.000Z',
	updatedAt: '2025-01-01T08:00:00.000Z',
	archived: false,
	...overrides
});

const mark = (
	date: string,
	habitId = 'h1',
	extra: Partial<HabitCompletion> = {}
): HabitCompletion => ({
	id: `${habitId}-${date}`,
	habitId,
	date,
	completed: true,
	createdAt: `${date}T08:00:00.000Z`,
	updatedAt: `${date}T08:00:00.000Z`,
	...extra
});

const states = (week: { state: string }[]) => week.map((day) => day.state);

describe('habitWeekHistory', () => {
	it('даёт семь дней от старого к сегодняшнему', () => {
		const week = habitWeekHistory(habit(), [], TODAY);
		expect(week).toHaveLength(7);
		expect(week[0].date).toBe('2026-01-09');
		expect(week[6].date).toBe(TODAY);
	});

	it('различает выполнено, пропущено и незакрытый сегодняшний день', () => {
		const week = habitWeekHistory(habit(), [mark('2026-01-09'), mark('2026-01-13')], TODAY);
		expect(states(week)).toEqual([
			'done',
			'missed',
			'missed',
			'missed',
			'done',
			'missed',
			'pending'
		]);
	});

	it('выходные у привычки «по будням» — не пропуск', () => {
		// 10-е и 11-е — суббота и воскресенье.
		const week = habitWeekHistory(habit({ frequency: 'weekdays' }), [], TODAY);
		expect(states(week).slice(1, 3)).toEqual(['rest', 'rest']);
		expect(week[0].state).toBe('missed');
	});

	it('дни до создания привычки — не пропуск', () => {
		const week = habitWeekHistory(habit({ createdAt: '2026-01-13T10:00:00.000Z' }), [], TODAY);
		expect(states(week)).toEqual(['rest', 'rest', 'rest', 'rest', 'missed', 'missed', 'pending']);
	});

	it('отметка показывается, даже если она раньше даты создания', () => {
		const late = habit({ createdAt: '2026-01-15T10:00:00.000Z' });
		const week = habitWeekHistory(late, [mark('2026-01-12')], TODAY);
		expect(week[3].state).toBe('done');
	});

	it('не учитывает снятые, удалённые и чужие отметки', () => {
		const week = habitWeekHistory(
			habit(),
			[
				mark('2026-01-12', 'h1', { completed: false }),
				mark('2026-01-13', 'h1', { deletedAt: '2026-01-13T09:00:00.000Z' }),
				mark('2026-01-14', 'h2')
			],
			TODAY
		);
		expect(states(week).slice(3, 6)).toEqual(['missed', 'missed', 'missed']);
	});

	it('отмеченный сегодня день — выполнен', () => {
		expect(habitWeekHistory(habit(), [mark(TODAY)], TODAY)[6].state).toBe('done');
	});
});

describe('weekScore', () => {
	it('не считает дни вне расписания и незакрытый сегодняшний', () => {
		const week = habitWeekHistory(
			habit({ frequency: 'weekdays' }),
			[mark('2026-01-09'), mark('2026-01-12')],
			TODAY
		);
		// Пт 9 — да, Сб/Вс — вне расписания, Пн 12 — да, Вт/Ср — нет, Чт — сегодня.
		expect(weekScore(week)).toEqual({ done: 2, planned: 4 });
	});
});

describe('groupHabitsForDay', () => {
	const daily = habit({ id: 'a' });
	const weekend = habit({ id: 'b', frequency: 'custom', targetDays: [0, 6] });
	const doneOne = habit({ id: 'c' });
	const archived = habit({ id: 'd', archived: true });

	it('раскладывает на «осталось», «сделано» и «не сегодня»', () => {
		const groups = groupHabitsForDay(
			[daily, weekend, doneOne, archived],
			[mark(TODAY, 'c')],
			TODAY
		);
		expect(groups.todo.map((item) => item.id)).toEqual(['a']);
		expect(groups.done.map((item) => item.id)).toEqual(['c']);
		expect(groups.off.map((item) => item.id)).toEqual(['b']);
	});

	it('выполненная вне расписания привычка считается сделанной', () => {
		const groups = groupHabitsForDay([weekend], [mark(TODAY, 'b')], TODAY);
		expect(groups.done).toHaveLength(1);
		expect(groups.off).toHaveLength(0);
	});

	it('сохраняет исходный порядок внутри группы', () => {
		const first = habit({ id: 'x' });
		const second = habit({ id: 'y' });
		const groups = groupHabitsForDay([first, second], [], TODAY);
		expect(groups.todo.map((item) => item.id)).toEqual(['x', 'y']);
	});
});
