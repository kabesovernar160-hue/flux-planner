import type { FinanceCategory, FinanceEntry } from '$lib/types/finance';
import type { Habit, HabitCompletion } from '$lib/types/habit';
import type { FoodEntry } from '$lib/types/nutrition';
import type { PlanItem } from '$lib/types/plan';
import type { WeightEntry } from '$lib/types/weight';
import { changeShare, type DayValue } from './analytics';
import { addDays, dayOfWeek, type DateKey } from './date';
import { pluralDays } from './format';
import { scheduledHabits } from './habitFrequency';

/**
 * Итоги недели.
 *
 * Одни и те же чистые функции считают отчёт на экране /week и сообщение бота
 * в воскресенье. Разойтись им нельзя: человек, получивший в чате «привычки
 * 86 %», должен увидеть в приложении те же 86 %, а не 84.
 *
 * Неделя — с понедельника по воскресенье. Даты записей уже хранятся в поясе
 * пользователя (ключ дня YYYY-MM-DD), поэтому здесь поясов нет вовсе:
 * граница суток давно проведена там, где запись создавалась.
 */

export interface WeekData {
	foodEntries: FoodEntry[];
	habits: Habit[];
	completions: HabitCompletion[];
	financeEntries: FinanceEntry[];
	planItems: PlanItem[];
	weightEntries: WeightEntry[];
	/** Цели дня, если у дня есть своя запись. Иначе берётся шаблон из настроек. */
	calorieGoals?: Record<DateKey, number>;
	budgets?: Record<DateKey, number>;
	defaultCalorieGoal: number;
	defaultBudget: number;
}

export interface WeekDay {
	date: DateKey;
	calories: number;
	calorieGoal: number;
	/** Калории записаны и попали в коридор цели. */
	inGoal: boolean;
	habitsDone: number;
	habitsPlanned: number;
	spent: number;
	budget: number;
	planDone: number;
	planTotal: number;
	hasAnything: boolean;
}

export interface WeekReport {
	start: DateKey;
	end: DateKey;
	days: WeekDay[];
	/** Дни, в которые было хоть что-то записано. */
	activeDays: number;
	isEmpty: boolean;
	nutrition: {
		/** Среднее по дням с записями — пропуски не изображают дефицит. */
		avgCalories: number;
		trackedDays: number;
		inGoalDays: number;
		byDay: DayValue[];
		/** Средняя цель недели: у разных дней она может отличаться. */
		goal: number;
	};
	habits: {
		done: number;
		planned: number;
		/** Доля закрытых, 0…1. null — на неделе нечего было закрывать. */
		rate: number | null;
		/** Самая длинная серия дней подряд, где закрыто всё запланированное. */
		bestStreak: number;
		byDay: DayValue[];
	};
	finance: {
		spent: number;
		budget: number;
		overBudgetDays: number;
		byCategory: { category: FinanceCategory; amount: number }[];
		byDay: DayValue[];
		dailyBudget: number;
	};
	plan: { done: number; total: number };
	weight: {
		/** Последнее взвешивание до недели или первое в ней. */
		from: number | null;
		/** Последнее взвешивание недели. */
		to: number | null;
		change: number | null;
	};
}

/**
 * Коридор «в цели»: ±10 % от цели.
 *
 * Точное попадание в калорию не бывает, а «не больше цели» засчитывало бы
 * день, в который записан один завтрак. Десять процентов — это разница
 * в один перекус, её и считаем попаданием.
 */
export const GOAL_TOLERANCE = 0.1;

/** Понедельник недели, в которую входит день. */
export function weekStartOf(date: DateKey): DateKey {
	const dow = dayOfWeek(date); // 0 — воскресенье
	return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function weekDates(start: DateKey): DateKey[] {
	return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function finite(value: number): number {
	return Number.isFinite(value) ? value : 0;
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + finite(value), 0);
}

function alive<T extends { deletedAt?: string | null }>(items: T[]): T[] {
	return items.filter((item) => !item.deletedAt);
}

export function buildWeekReport(data: WeekData, start: DateKey): WeekReport {
	const dates = weekDates(start);
	const end = dates[6];

	const foods = alive(data.foodEntries);
	const finance = alive(data.financeEntries);
	const plan = alive(data.planItems);
	const completions = alive(data.completions).filter((item) => item.completed);
	const habits = alive(data.habits);

	const doneByDate = new Map<DateKey, Set<string>>();
	for (const completion of completions) {
		const set = doneByDate.get(completion.date) ?? new Set<string>();
		set.add(completion.habitId);
		doneByDate.set(completion.date, set);
	}

	const days: WeekDay[] = dates.map((date) => {
		const calories = sum(
			foods.filter((entry) => entry.date === date).map((entry) => entry.calories)
		);
		const calorieGoal = data.calorieGoals?.[date] ?? data.defaultCalorieGoal;
		const spent = sum(
			finance
				.filter((entry) => entry.date === date && entry.type === 'expense')
				.map((entry) => entry.amount)
		);
		const budget = data.budgets?.[date] ?? data.defaultBudget;

		const planned = scheduledHabits(habits, date);
		const done = doneByDate.get(date);
		const habitsDone = planned.filter((habit) => done?.has(habit.id)).length;

		const dayPlan = plan.filter((item) => item.date === date);
		const planDone = dayPlan.filter((item) => item.done).length;

		const inGoal =
			calories > 0 &&
			calorieGoal > 0 &&
			Math.abs(calories - calorieGoal) <= calorieGoal * GOAL_TOLERANCE;

		return {
			date,
			calories,
			calorieGoal,
			inGoal,
			habitsDone,
			habitsPlanned: planned.length,
			spent,
			budget,
			planDone,
			planTotal: dayPlan.length,
			hasAnything: calories > 0 || spent > 0 || habitsDone > 0 || dayPlan.length > 0
		};
	});

	const tracked = days.filter((day) => day.calories > 0);
	const habitsPlanned = sum(days.map((day) => day.habitsPlanned));
	const habitsDone = sum(days.map((day) => day.habitsDone));

	// Серия внутри недели: день без плана не рвёт её и не удлиняет —
	// как и счётчик в шапке приложения.
	let bestStreak = 0;
	let run = 0;
	for (const day of days) {
		if (day.habitsPlanned === 0) continue;
		if (day.habitsDone === day.habitsPlanned) {
			run += 1;
			bestStreak = Math.max(bestStreak, run);
		} else {
			run = 0;
		}
	}

	const categoryTotals = new Map<FinanceCategory, number>();
	for (const entry of finance) {
		if (entry.type !== 'expense' || entry.date < start || entry.date > end) continue;
		categoryTotals.set(
			entry.category,
			(categoryTotals.get(entry.category) ?? 0) + finite(entry.amount)
		);
	}

	const weights = alive(data.weightEntries)
		.filter((entry) => entry.date <= end)
		.sort((a, b) => a.date.localeCompare(b.date));
	const inWeek = weights.filter((entry) => entry.date >= start);
	const before = weights.filter((entry) => entry.date < start).at(-1);
	const to = inWeek.at(-1)?.weightKg ?? null;
	const from = before?.weightKg ?? inWeek[0]?.weightKg ?? null;
	// Одно взвешивание за неделю без предыдущего — ещё не изменение.
	const hasTwoPoints = inWeek.length > 0 && (before !== undefined || inWeek.length > 1);

	const activeDays = days.filter((day) => day.hasAnything).length;

	return {
		start,
		end,
		days,
		activeDays,
		isEmpty: activeDays === 0 && inWeek.length === 0,
		nutrition: {
			avgCalories:
				tracked.length > 0 ? sum(tracked.map((day) => day.calories)) / tracked.length : 0,
			trackedDays: tracked.length,
			inGoalDays: days.filter((day) => day.inGoal).length,
			byDay: days.map((day) => ({ date: day.date, value: day.calories })),
			goal: sum(days.map((day) => day.calorieGoal)) / days.length
		},
		habits: {
			done: habitsDone,
			planned: habitsPlanned,
			rate: habitsPlanned > 0 ? habitsDone / habitsPlanned : null,
			bestStreak,
			byDay: days.map((day) => ({
				date: day.date,
				value: day.habitsPlanned > 0 ? Math.round((day.habitsDone / day.habitsPlanned) * 100) : 0
			}))
		},
		finance: {
			spent: sum(days.map((day) => day.spent)),
			budget: sum(days.map((day) => day.budget)),
			overBudgetDays: days.filter((day) => day.budget > 0 && day.spent > day.budget).length,
			byCategory: [...categoryTotals]
				.map(([category, amount]) => ({ category, amount }))
				.sort((a, b) => b.amount - a.amount),
			byDay: days.map((day) => ({ date: day.date, value: day.spent })),
			dailyBudget: sum(days.map((day) => day.budget)) / days.length
		},
		plan: {
			done: sum(days.map((day) => day.planDone)),
			total: sum(days.map((day) => day.planTotal))
		},
		weight: {
			from,
			to,
			change:
				hasTwoPoints && from !== null && to !== null ? Math.round((to - from) * 10) / 10 : null
		}
	};
}

/* ───────────────── Сравнение с прошлой неделей ───────────────── */

export interface WeekComparison {
	/** Относительные изменения: 0,12 — «на 12 % больше». null — сравнивать не с чем. */
	calories: number | null;
	spent: number | null;
	planDone: number | null;
	/** Доля привычек прошлой недели, 0…1: сравнивается «было / стало», а не процент от процента. */
	previousHabitRate: number | null;
}

export function compareWeeks(current: WeekReport, previous: WeekReport): WeekComparison {
	return {
		calories: changeShare(current.nutrition.avgCalories, previous.nutrition.avgCalories),
		spent: changeShare(current.finance.spent, previous.finance.spent),
		planDone: changeShare(current.plan.done, previous.plan.done),
		previousHabitRate: previous.habits.rate
	};
}

/** Ниже этого изменения разница — шум, и стрелку не рисуем. */
export const CHANGE_NOISE = 0.03;

export interface ChangeLabel {
	arrow: '↑' | '↓' | '→';
	text: string;
}

/** «↑ 12 %», «↓ 18 %» или «→ столько же». */
export function formatChange(change: number | null): ChangeLabel | null {
	if (change === null || !Number.isFinite(change)) return null;
	if (Math.abs(change) < CHANGE_NOISE) return { arrow: '→', text: 'столько же' };

	const percent = Math.round(Math.abs(change) * 100);
	return { arrow: change > 0 ? '↑' : '↓', text: `${percent} %` };
}

export function percent(rate: number | null): number | null {
	return rate === null ? null : Math.round(rate * 100);
}

/* ───────────────── Выводы и совет ───────────────── */

/** Именительный падеж: «лучший день — среда». */
const WEEKDAY_NAMES = [
	'воскресенье',
	'понедельник',
	'вторник',
	'среда',
	'четверг',
	'пятница',
	'суббота'
];

export function weekdayName(date: DateKey): string {
	return WEEKDAY_NAMES[dayOfWeek(date)];
}

/** Винительный падеж для «траты на …». */
const CATEGORY_TARGET: Partial<Record<FinanceCategory, string>> = {
	food: 'еду',
	transport: 'транспорт',
	shopping: 'покупки',
	entertainment: 'развлечения',
	health: 'здоровье',
	education: 'образование',
	subscriptions: 'подписки'
};

/**
 * Оценка дня для «лучшего дня».
 *
 * Каждый раздел даёт до одного балла: все привычки, калории в коридоре,
 * траты в пределах лимита. День без записей не участвует вовсе — лучшим
 * днём не может оказаться тот, о котором ничего не известно.
 */
function dayScore(day: WeekDay): number {
	let score = 0;
	if (day.habitsPlanned > 0) score += day.habitsDone / day.habitsPlanned;
	if (day.inGoal) score += 1;
	if (day.spent > 0 && day.budget > 0 && day.spent <= day.budget) score += 0.5;
	return score;
}

function bestDayReason(day: WeekDay): string {
	const parts: string[] = [];
	if (day.habitsPlanned > 0 && day.habitsDone === day.habitsPlanned)
		parts.push('все привычки закрыты');
	if (day.inGoal) parts.push('калории в цели');
	if (parts.length === 0 && day.spent > 0 && day.spent <= day.budget) parts.push('траты в лимите');
	return parts.join(' и ');
}

/**
 * Один-два вывода простым языком.
 *
 * Не пересказ цифр — они и так на экране, — а то, что из них следует:
 * какой день удался и что заметно изменилось. Порядок — от приятного
 * к полезному: неделю, которая началась с похвалы, хочется повторить.
 */
export function weekInsights(current: WeekReport, previous: WeekReport | null): string[] {
	const insights: string[] = [];

	const scored = current.days
		.filter((day) => day.hasAnything)
		.map((day) => ({ day, score: dayScore(day) }))
		.sort((a, b) => b.score - a.score);

	// Лучший день осмыслен, только когда было из чего выбирать и он
	// действительно выделяется: при равенстве «лучшим» стал бы первый попавшийся.
	if (scored.length >= 2 && scored[0].score > 0 && scored[0].score > scored[1].score) {
		const reason = bestDayReason(scored[0].day);
		const name = weekdayName(scored[0].day.date);
		insights.push(reason ? `Лучший день — ${name}: ${reason}.` : `Лучший день — ${name}.`);
	}

	if (previous && !previous.isEmpty) {
		const categoryInsight = biggestCategoryChange(current, previous);
		if (categoryInsight) insights.push(categoryInsight);
	}

	if (insights.length < 2 && current.habits.bestStreak >= 3) {
		insights.push(
			`Серия ${current.habits.bestStreak} ${pluralDays(current.habits.bestStreak)} подряд — все привычки закрыты.`
		);
	}

	if (insights.length < 2 && current.nutrition.trackedDays > 0) {
		insights.push(
			`Калории в цели ${current.nutrition.inGoalDays} из ${current.nutrition.trackedDays} ${ofDays(current.nutrition.trackedDays)} с записями.`
		);
	}

	return insights.slice(0, 2);
}

/**
 * Категория трат, изменившаяся заметнее всех.
 *
 * Мелкие категории не в счёт: «подписки +200 %» на двух сотнях рублей
 * пугает больше, чем значит. Порог — десятая часть трат недели.
 */
function biggestCategoryChange(current: WeekReport, previous: WeekReport): string | null {
	const scale = Math.max(current.finance.spent, previous.finance.spent);
	if (scale <= 0) return null;

	const amounts = (report: WeekReport) =>
		new Map(report.finance.byCategory.map((item) => [item.category, item.amount]));
	const now = amounts(current);
	const before = amounts(previous);

	let best: { category: FinanceCategory; change: number } | null = null;

	for (const [category, previousAmount] of before) {
		const target = CATEGORY_TARGET[category];
		if (!target) continue;

		const currentAmount = now.get(category) ?? 0;
		if (Math.max(currentAmount, previousAmount) < scale * 0.1) continue;

		const change = changeShare(currentAmount, previousAmount);
		if (change === null || Math.abs(change) < 0.1) continue;
		if (!best || Math.abs(change) > Math.abs(best.change)) best = { category, change };
	}

	if (!best) return null;

	const value = Math.round(Math.abs(best.change) * 100);
	const sign = best.change > 0 ? '+' : '−';
	return `Траты на ${CATEGORY_TARGET[best.category]} ${sign}${value} % к прошлой неделе.`;
}

/** После «из»: «из 1 дня», «из 7 дней». */
function ofDays(n: number): string {
	return n % 10 === 1 && n % 100 !== 11 ? 'дня' : 'дней';
}

/**
 * Один совет на следующую неделю.
 *
 * Один, а не список: из пяти советов не выполняется ни один. Выбирается
 * самое слабое место недели, и совет — про маленький следующий шаг,
 * а не про то, как всё было плохо.
 */
export function weekAdvice(report: WeekReport): string {
	if (report.isEmpty) {
		return 'Начните с одной записи в день — еда, привычка или трата. К воскресенью здесь соберётся картина недели.';
	}

	if (report.nutrition.trackedDays < 4) {
		return 'Записывайте еду хотя бы 4 дня из 7 — тогда средние калории станут честными, а не случайными.';
	}

	if (report.habits.rate !== null && report.habits.rate < 0.6) {
		return 'Оставьте 2–3 главные привычки: лучше закрывать немного, но каждый день, чем много — через раз.';
	}

	if (report.finance.overBudgetDays >= 3) {
		return `Лимит превышался ${report.finance.overBudgetDays} ${pluralDays(report.finance.overBudgetDays)}. Запланируйте крупные траты заранее — или поднимите лимит до честного.`;
	}

	if (report.nutrition.inGoalDays < report.nutrition.trackedDays / 2) {
		return 'Калории чаще мимо цели, чем в ней. Попробуйте записывать еду до еды — так проще успеть поправить порцию.';
	}

	return 'Неделя ровная. Держите тот же ритм — и добавьте одну маленькую привычку, если хочется большего.';
}

/* ───────────────── Тексты наружу ───────────────── */

/** Подпись недели: «22–28 сентября» или «29 сентября — 5 октября». */
const MONTHS_OF = [
	'января',
	'февраля',
	'марта',
	'апреля',
	'мая',
	'июня',
	'июля',
	'августа',
	'сентября',
	'октября',
	'ноября',
	'декабря'
];

export function weekLabel(start: DateKey): string {
	const end = addDays(start, 6);
	const [, startMonth, startDay] = start.split('-').map(Number);
	const [, endMonth, endDay] = end.split('-').map(Number);

	if (startMonth === endMonth) return `${startDay}–${endDay} ${MONTHS_OF[endMonth - 1]}`;
	return `${startDay} ${MONTHS_OF[startMonth - 1]} — ${endDay} ${MONTHS_OF[endMonth - 1]}`;
}

/**
 * Текст для «Поделиться».
 *
 * Только проценты и серии: сколько человек съел и потратил — его личное
 * дело, и отправлять это в чужой чат по умолчанию нельзя. Пустые разделы
 * пропускаются, чтобы не хвастаться нулём.
 */
export function weekShareText(report: WeekReport): string {
	const parts: string[] = [];

	const habits = percent(report.habits.rate);
	if (habits !== null) parts.push(`привычки — ${habits} %`);

	if (report.habits.bestStreak >= 2) {
		parts.push(`серия ${report.habits.bestStreak} ${pluralDays(report.habits.bestStreak)}`);
	}

	if (report.nutrition.trackedDays > 0) {
		const share = Math.round((report.nutrition.inGoalDays / report.nutrition.trackedDays) * 100);
		parts.push(`калории в цели — ${share} % дней`);
	}

	if (report.plan.total > 0) {
		parts.push(`план выполнен на ${Math.round((report.plan.done / report.plan.total) * 100)} %`);
	}

	const body = parts.length > 0 ? `: ${parts.join(', ')}` : '';
	return `Моя неделя в Flux Planner${body}. Веду дневник еды, привычек и трат здесь:`;
}

/**
 * Три строки для бота.
 *
 * Коротко и без таблицы: сообщение читают в списке чатов, по первым
 * строкам. Подробности — по кнопке, в приложении.
 */
export function weekBotLines(
	report: WeekReport,
	previous: WeekReport | null,
	formatMoney: (value: number) => string
): string[] {
	const comparison = previous ? compareWeeks(report, previous) : null;
	const tail = (change: number | null) => {
		const label = formatChange(change);
		return label && label.arrow !== '→' ? ` · ${label.arrow} ${label.text}` : '';
	};

	const lines: string[] = [];

	const habits = percent(report.habits.rate);
	lines.push(
		habits === null
			? 'Привычки: на неделе не было запланированных'
			: `Привычки: ${habits} %${report.habits.bestStreak >= 2 ? ` · серия ${report.habits.bestStreak} ${pluralDays(report.habits.bestStreak)}` : ''}`
	);

	lines.push(
		report.nutrition.trackedDays === 0
			? 'Еда: записей не было'
			: `Калории в цели ${report.nutrition.inGoalDays} из ${report.nutrition.trackedDays} ${ofDays(report.nutrition.trackedDays)}${tail(comparison?.calories ?? null)}`
	);

	lines.push(
		report.finance.spent === 0
			? 'Траты: записей не было'
			: `Траты: ${formatMoney(report.finance.spent)} из ${formatMoney(report.finance.budget)}${tail(comparison?.spent ?? null)}`
	);

	return lines;
}
