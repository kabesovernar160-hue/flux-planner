import type { Habit } from '$lib/types/habit';
import { dayOfWeek, type DateKey } from './date';

/** Понедельник–пятница. 0 — воскресенье, 6 — суббота. */
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * Запланирована ли привычка на этот день.
 *
 * Отличать «не запланировано» от «пропущено» принципиально: в Phase 3
 * на этом строится стрик — незапланированный день его не ломает.
 */
export function isScheduledOn(habit: Habit, date: DateKey): boolean {
	const weekday = dayOfWeek(date);

	switch (habit.frequency) {
		case 'daily':
			return true;
		case 'weekdays':
			return WEEKDAYS.includes(weekday);
		case 'custom':
			// Пустой или отсутствующий список означает, что расписание не задано:
			// считаем, что на этот день привычка не запланирована.
			return Array.isArray(habit.targetDays) && habit.targetDays.includes(weekday);
		default:
			return false;
	}
}

/** Активные привычки, запланированные на указанный день. */
export function scheduledHabits(habits: Habit[], date: DateKey): Habit[] {
	return habits.filter((habit) => !habit.archived && isScheduledOn(habit, date));
}
