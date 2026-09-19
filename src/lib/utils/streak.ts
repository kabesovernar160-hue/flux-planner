import type { Habit, HabitCompletion } from '$lib/types/habit';
import { addDays, type DateKey } from './date';
import { isScheduledOn, scheduledHabits } from './habitFrequency';

export interface StreakStats {
	current: number;
	longest: number;
	totalCompleted: number;
	lastCompletedDate: DateKey | null;
}

/** Потолок обхода: страховка от битого createdAt, а не ограничение логики. */
const MAX_LOOKBACK_DAYS = 3650;

/** Дальше семи дней подряд ни одно расписание не может быть без запланированного дня. */
const MAX_GAP_DAYS = 8;

/** День создания привычки. Раньше него стрика быть не может. */
function createdOn(habit: Habit): DateKey {
	return habit.createdAt.slice(0, 10);
}

function completedDates(habitId: string, completions: HabitCompletion[]): Set<DateKey> {
	const dates = new Set<DateKey>();
	for (const completion of completions) {
		if (completion.habitId === habitId && completion.completed) dates.add(completion.date);
	}
	return dates;
}

/**
 * Предыдущий запланированный день.
 *
 * Нужен, чтобы отличать пропуск от выходного: у привычки «по будням»
 * понедельник идёт сразу за пятницей, и суббота с воскресеньем стрик не рвут.
 */
export function previousScheduledDay(habit: Habit, from: DateKey, floor: DateKey): DateKey | null {
	let cursor = addDays(from, -1);

	for (let step = 0; step < MAX_GAP_DAYS; step++) {
		if (cursor < floor) return null;
		if (isScheduledOn(habit, cursor)) return cursor;
		cursor = addDays(cursor, -1);
	}

	return null;
}

/**
 * Текущий стрик.
 *
 * Незакрытый сегодняшний день не считается разрывом: пока день не кончился,
 * привычку ещё можно выполнить, и обнулять счётчик в полдень — значит наказывать
 * пользователя за то, что он просто не дошёл до вечера.
 */
export function calculateCurrentStreak(
	habit: Habit,
	completions: HabitCompletion[],
	today: DateKey
): number {
	const done = completedDates(habit.id, completions);
	const floor = createdOn(habit);

	let cursor: DateKey | null = today;

	// Если сегодня запланировано и ещё не отмечено — отсчёт начинается со вчера.
	if (isScheduledOn(habit, today) && !done.has(today)) {
		cursor = previousScheduledDay(habit, today, floor);
	} else if (!isScheduledOn(habit, today)) {
		cursor = previousScheduledDay(habit, today, floor);
	}

	let streak = 0;

	while (cursor !== null && streak < MAX_LOOKBACK_DAYS) {
		if (!done.has(cursor)) break;
		streak += 1;
		cursor = previousScheduledDay(habit, cursor, floor);
	}

	return streak;
}

/**
 * Самый длинный стрик за всю историю.
 *
 * Обход идёт по отметкам, а не по календарю: у привычки, заведённой два года
 * назад, календарный проход — это семьсот итераций на каждый пересчёт
 * производного значения.
 */
export function calculateLongestStreak(
	habit: Habit,
	completions: HabitCompletion[],
	today: DateKey
): number {
	const done = completedDates(habit.id, completions);
	const floor = createdOn(habit);

	// Будущие отметки не учитываются ни в каком виде.
	const dates = [...done].filter((date) => date <= today).sort();

	let longest = 0;
	let run = 0;
	let previous: DateKey | null = null;

	for (const date of dates) {
		const expected = previousScheduledDay(habit, date, floor);
		run = previous !== null && expected === previous ? run + 1 : 1;
		if (run > longest) longest = run;
		previous = date;
	}

	return longest;
}

export function getStreakStats(
	habit: Habit,
	completions: HabitCompletion[],
	today: DateKey
): StreakStats {
	const done = [...completedDates(habit.id, completions)].filter((date) => date <= today).sort();

	return {
		current: calculateCurrentStreak(habit, completions, today),
		longest: calculateLongestStreak(habit, completions, today),
		totalCompleted: done.length,
		lastCompletedDate: done.at(-1) ?? null
	};
}

/**
 * Состояние дня.
 *
 * Различать «пусто» и «пропущено» обязательно: если все привычки заведены
 * по будням, то выходной — это день без плана, а не провал. Считать его
 * разрывом значит обнулять стрик каждую субботу.
 */
type DayStatus = 'closed' | 'missed' | 'empty';

function createDayStatusReader(habits: Habit[], completions: HabitCompletion[]) {
	const active = habits.filter((habit) => !habit.archived);

	const doneByDate = new Map<DateKey, Set<string>>();
	for (const completion of completions) {
		if (!completion.completed) continue;
		let set = doneByDate.get(completion.date);
		if (!set) {
			set = new Set();
			doneByDate.set(completion.date, set);
		}
		set.add(completion.habitId);
	}

	const floor =
		active.length === 0
			? null
			: active.reduce(
					(earliest, habit) => (createdOn(habit) < earliest ? createdOn(habit) : earliest),
					createdOn(active[0])
				);

	const status = (date: DateKey): DayStatus => {
		const scheduled = scheduledHabits(active, date);
		if (scheduled.length === 0) return 'empty';

		const done = doneByDate.get(date);
		return done !== undefined && scheduled.every((habit) => done.has(habit.id))
			? 'closed'
			: 'missed';
	};

	return { status, floor, isEmpty: active.length === 0 };
}

/**
 * Стрик по дню целиком: подряд идущие дни, где закрыты все запланированные
 * привычки. Это то, что показывает плашка в шапке — один счётчик на экран,
 * а не отдельный у каждой привычки.
 */
export function calculateDayStreak(
	habits: Habit[],
	completions: HabitCompletion[],
	today: DateKey
): number {
	const { status, floor, isEmpty } = createDayStatusReader(habits, completions);
	if (isEmpty || floor === null) return 0;

	let cursor = today;

	// Незакрытый сегодняшний день не обрывает стрик — он ещё не кончился.
	if (status(cursor) !== 'closed') cursor = addDays(cursor, -1);

	let streak = 0;
	let guard = 0;

	while (cursor >= floor && guard < MAX_LOOKBACK_DAYS) {
		guard += 1;
		const state = status(cursor);

		if (state === 'missed') break;
		if (state === 'closed') streak += 1;
		// 'empty' — день без плана: не считается и не рвёт.

		cursor = addDays(cursor, -1);
	}

	return streak;
}

/** Лучший результат по дню за всю историю. */
export function calculateLongestDayStreak(
	habits: Habit[],
	completions: HabitCompletion[],
	today: DateKey
): number {
	const { status, floor, isEmpty } = createDayStatusReader(habits, completions);
	if (isEmpty || floor === null) return 0;

	let longest = 0;
	let run = 0;
	let cursor = floor;
	let guard = 0;

	while (cursor <= today && guard < MAX_LOOKBACK_DAYS) {
		guard += 1;
		const state = status(cursor);

		if (state === 'closed') {
			run += 1;
			if (run > longest) longest = run;
		} else if (state === 'missed' && cursor !== today) {
			// Сегодняшний незакрытый день не обрывает текущую серию.
			run = 0;
		}

		cursor = addDays(cursor, 1);
	}

	return longest;
}
