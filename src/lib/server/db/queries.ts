import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './client';
import {
	dailyFinance,
	dailyNutrition,
	financeEntries,
	foodEntries,
	habitCompletions,
	habits,
	plannerState,
	weightEntries
} from './schema';
import type { DailyFinance, FinanceEntry } from '$lib/types/finance';
import type { Habit, HabitCompletion } from '$lib/types/habit';
import type { DailyNutrition, FoodEntry } from '$lib/types/nutrition';
import type { WeightEntry } from '$lib/types/weight';

/**
 * Чтения для отчётов и уведомлений.
 *
 * Отдельно от репозиториев синхронизации: у тех задача — отдать всё изменённое
 * с момента X, а здесь нужен срез одного дня. Смешивать эти две выборки в одном
 * интерфейсе значит получить репозиторий, который умеет всё и непонятен нигде.
 *
 * Все запросы фильтруют по userId и отбрасывают надгробия.
 */

/**
 * Настройки пользователя с сервера.
 *
 * Лежат JSON-блобом в planner_state: форму задаёт клиент, сервер её не знает
 * и не обязан знать. Наружу отдаётся как unknown — разбирать поля должен тот,
 * кому они нужны.
 */
export async function loadPlannerSettings(db: Db, userId: string): Promise<unknown> {
	const [row] = await db
		.select({ settings: plannerState.settings })
		.from(plannerState)
		.where(eq(plannerState.userId, userId))
		.limit(1);

	return row?.settings ?? null;
}

export interface DaySnapshot {
	foods: FoodEntry[];
	nutrition: DailyNutrition | null;
	habits: Habit[];
	completions: HabitCompletion[];
	finance: FinanceEntry[];
	budget: DailyFinance | null;
	/** Взвешивание этого дня, если оно было. */
	weight: WeightEntry | null;
}

export async function loadDaySnapshot(db: Db, userId: string, date: string): Promise<DaySnapshot> {
	const [foods, nutritionRows, habitRows, completionRows, financeRows, budgetRows, weightRows] =
		await Promise.all([
			db
				.select()
				.from(foodEntries)
				.where(
					and(
						eq(foodEntries.userId, userId),
						eq(foodEntries.date, date),
						isNull(foodEntries.deletedAt)
					)
				),
			db
				.select()
				.from(dailyNutrition)
				.where(
					and(
						eq(dailyNutrition.userId, userId),
						eq(dailyNutrition.date, date),
						isNull(dailyNutrition.deletedAt)
					)
				)
				.limit(1),
			db
				.select()
				.from(habits)
				.where(and(eq(habits.userId, userId), isNull(habits.deletedAt))),
			db
				.select()
				.from(habitCompletions)
				.where(
					and(
						eq(habitCompletions.userId, userId),
						eq(habitCompletions.date, date),
						isNull(habitCompletions.deletedAt)
					)
				),
			db
				.select()
				.from(financeEntries)
				.where(
					and(
						eq(financeEntries.userId, userId),
						eq(financeEntries.date, date),
						isNull(financeEntries.deletedAt)
					)
				),
			db
				.select()
				.from(dailyFinance)
				.where(
					and(
						eq(dailyFinance.userId, userId),
						eq(dailyFinance.date, date),
						isNull(dailyFinance.deletedAt)
					)
				)
				.limit(1),
			db
				.select()
				.from(weightEntries)
				.where(
					and(
						eq(weightEntries.userId, userId),
						eq(weightEntries.date, date),
						isNull(weightEntries.deletedAt)
					)
				)
				.limit(1)
		]);

	return {
		foods: foods as unknown as FoodEntry[],
		nutrition: (nutritionRows[0] as unknown as DailyNutrition) ?? null,
		habits: habitRows as unknown as Habit[],
		completions: completionRows as unknown as HabitCompletion[],
		finance: financeRows as unknown as FinanceEntry[],
		budget: (budgetRows[0] as unknown as DailyFinance) ?? null,
		weight: (weightRows[0] as unknown as WeightEntry) ?? null
	};
}
