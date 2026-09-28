import type { Habit, HabitCompletion } from '$lib/types/habit';
import { addDays, type DateKey } from './date';
import { isScheduledOn } from './habitFrequency';

/**
 * Состояние одного дня в мини-истории привычки.
 *
 * - done — отмечено;
 * - missed — было запланировано и прошло без отметки;
 * - pending — запланировано на опорный день и ещё не отмечено: день
 *   не кончился, и рисовать его пропуском значило бы упрекать заранее;
 * - rest — привычки в этот день не было в расписании (или её ещё не
 *   завели): это не провал, и выглядеть он должен тише пропуска.
 */
export type HabitDayState = 'done' | 'missed' | 'pending' | 'rest';

export interface HabitWeekDay {
	date: DateKey;
	state: HabitDayState;
}

/** Сколько дней в мини-истории. Неделя — период, который глаз схватывает целиком. */
export const HABIT_WEEK_DAYS = 7;

function doneDates(habitId: string, completions: HabitCompletion[]): Set<DateKey> {
	const dates = new Set<DateKey>();
	for (const completion of completions) {
		if (completion.habitId === habitId && completion.completed && !completion.deletedAt) {
			dates.add(completion.date);
		}
	}
	return dates;
}

/**
 * Последние семь дней привычки, от старого к опорному (обычно — сегодня).
 *
 * Неделя скользящая, а не «с понедельника»: в понедельник календарная
 * неделя состояла бы из одной точки, и история ничего бы не говорила.
 *
 * Отметка важнее даты создания: после импорта или синхронизации createdAt
 * бывает позже реальных отметок, и прятать выполненный день из-за этого
 * было бы враньём. А вот незаполненный день до создания — не пропуск.
 */
export function habitWeekHistory(
	habit: Habit,
	completions: HabitCompletion[],
	today: DateKey,
	days: number = HABIT_WEEK_DAYS
): HabitWeekDay[] {
	const done = doneDates(habit.id, completions);
	const created = habit.createdAt.slice(0, 10);
	const result: HabitWeekDay[] = [];

	for (let back = days - 1; back >= 0; back--) {
		const date = addDays(today, -back);
		let state: HabitDayState;

		if (done.has(date)) state = 'done';
		else if (date < created || !isScheduledOn(habit, date)) state = 'rest';
		else if (date === today) state = 'pending';
		else state = 'missed';

		result.push({ date, state });
	}

	return result;
}

/** Сколько запланированных дней недели закрыто — для подписи к точкам. */
export function weekScore(week: HabitWeekDay[]): { done: number; planned: number } {
	let done = 0;
	let planned = 0;
	for (const day of week) {
		if (day.state === 'rest') continue;
		// Незакрытый сегодняшний день в знаменатель не идёт: он ещё не проигран.
		if (day.state === 'pending') continue;
		planned += 1;
		if (day.state === 'done') done += 1;
	}
	return { done, planned };
}

export interface HabitDayGroups<T extends Habit = Habit> {
	/** Запланированы и ещё не отмечены — то, ради чего человек открыл экран. */
	todo: T[];
	/** Отмечены за день. */
	done: T[];
	/** В расписании дня их нет: показываются отдельно и тише. */
	off: T[];
}

/**
 * Раскладка активных привычек дня по группам.
 *
 * Невыполненные наверху: список отвечает на вопрос «что ещё осталось»,
 * и сделанное не должно заслонять несделанное. Внутри группы порядок
 * исходный — привычки не прыгают местами от отметки к отметке.
 *
 * Отмеченная в незапланированный день привычка считается сделанной:
 * человек её выполнил, и прятать это в «не сегодня» было бы странно.
 */
export function groupHabitsForDay<T extends Habit>(
	habits: T[],
	completions: HabitCompletion[],
	date: DateKey
): HabitDayGroups<T> {
	const doneToday = new Set<string>();
	for (const completion of completions) {
		if (completion.date === date && completion.completed && !completion.deletedAt) {
			doneToday.add(completion.habitId);
		}
	}

	const groups: HabitDayGroups<T> = { todo: [], done: [], off: [] };

	for (const habit of habits) {
		if (habit.archived || habit.deletedAt) continue;
		if (doneToday.has(habit.id)) groups.done.push(habit);
		else if (isScheduledOn(habit, date)) groups.todo.push(habit);
		else groups.off.push(habit);
	}

	return groups;
}
