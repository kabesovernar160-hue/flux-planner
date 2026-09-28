import type { DayActivity } from './analytics';

/**
 * «Полнота» дня для заливки клетки календаря.
 *
 * Точки под числом отвечали только на вопрос «было ли что-то», и месяц
 * читался как россыпь одинаковых крапинок. Заливка по полноте отвечает
 * на вопрос, ради которого календарь открывают: какие дни прожиты «по
 * плану», а какие выпали. Точки остаются — по ним видно, какой раздел.
 *
 * Считается среднее по разделам, которые у дня вообще есть:
 * - еда — всегда: есть каждый день, и пустой дневник — это пробел;
 *   попадание в цель по калориям весит полный балл, просто записи — половину;
 * - привычки — доля закрытых, если что-то было запланировано;
 * - план — доля выполненных пунктов, если пункты были;
 * - траты — только если записаны: день без покупок — нормальный день,
 *   и штрафовать за него заливкой было бы неправдой.
 */
export interface DayFullness {
	/** 0…1. */
	score: number;
	/** Ступень заливки: 0 — пусто, 1…FULLNESS_LEVELS — от слабой к плотной. */
	level: number;
	/** Вклад каждого раздела, 0…1; null — раздела у дня нет, в среднее не входит. */
	parts: {
		food: number;
		habits: number | null;
		plan: number | null;
		money: number | null;
	};
}

/** Ступеней немного: глаз уверенно различает три-четыре плотности, не больше. */
export const FULLNESS_LEVELS = 4;

/**
 * Коридор «в цели» по калориям.
 *
 * Снизу шире, чем сверху: недобор в пару сотен — чаще незаписанный перекус,
 * чем реальная проблема, а перебор на 10 % уже заметен на весах.
 */
export const CALORIE_BAND = { low: 0.8, high: 1.1 } as const;

export function foodPart(calories: number, goal: number): number {
	if (calories <= 0) return 0;
	// Без цели проверить попадание нечем — засчитываем сам факт записи.
	if (!(goal > 0)) return 1;
	const ratio = calories / goal;
	return ratio >= CALORIE_BAND.low && ratio <= CALORIE_BAND.high ? 1 : 0.5;
}

export function dayFullness(
	activity: Pick<
		DayActivity,
		'calories' | 'spent' | 'habitsDone' | 'habitsPlanned' | 'planDone' | 'planTotal'
	>,
	calorieGoal: number
): DayFullness {
	const parts: DayFullness['parts'] = {
		food: foodPart(activity.calories, calorieGoal),
		habits:
			activity.habitsPlanned > 0 ? Math.min(1, activity.habitsDone / activity.habitsPlanned) : null,
		plan: activity.planTotal > 0 ? Math.min(1, activity.planDone / activity.planTotal) : null,
		money: activity.spent > 0 ? 1 : null
	};

	const counted = Object.values(parts).filter((value): value is number => value !== null);
	const score = counted.reduce((sum, value) => sum + value, 0) / counted.length;

	// Любая запись даёт хотя бы первую ступень: день, где что-то отмечено,
	// не должен выглядеть так же, как день, где не было ничего.
	const level =
		score <= 0 ? 0 : Math.min(FULLNESS_LEVELS, Math.max(1, Math.ceil(score * FULLNESS_LEVELS)));

	return { score, level, parts };
}
