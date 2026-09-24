import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import type { Db } from './client';
import {
	dailyFinance,
	dailyNutrition,
	financeEntries,
	foodEntries,
	habitCompletions,
	habits,
	planItems,
	plannerState,
	weightEntries
} from './schema';
import type { DailyFinance, FinanceEntry } from '$lib/types/finance';
import type { Habit, HabitCompletion } from '$lib/types/habit';
import type { DailyNutrition, FoodEntry } from '$lib/types/nutrition';
import type { PlanItem } from '$lib/types/plan';
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

export interface RangeSnapshot {
	foods: FoodEntry[];
	habits: Habit[];
	completions: HabitCompletion[];
	finance: FinanceEntry[];
	plan: PlanItem[];
	/** Все взвешивания до конца периода: изменению нужна точка до его начала. */
	weights: WeightEntry[];
	calorieGoals: Record<string, number>;
	budgets: Record<string, number>;
}

/**
 * Записи за период — для итогов недели.
 *
 * Один проход по диапазону дат вместо семи срезов по дню: неделя с прошлой
 * для сравнения — это четырнадцать дней, и четырнадцать отдельных запросов
 * на каждого получателя рассылки заметно тянули бы её.
 */
export async function loadRangeSnapshot(
	db: Db,
	userId: string,
	from: string,
	to: string
): Promise<RangeSnapshot> {
	const inRange = <T extends { userId: never; date: never; deletedAt: never }>(table: T) =>
		and(
			eq(table.userId, userId),
			gte(table.date, from),
			lte(table.date, to),
			isNull(table.deletedAt)
		);

	const [foods, habitRows, completions, finance, plan, weights, nutritionRows, budgetRows] =
		await Promise.all([
			db
				.select()
				.from(foodEntries)
				.where(inRange(foodEntries as never)),
			db
				.select()
				.from(habits)
				.where(and(eq(habits.userId, userId), isNull(habits.deletedAt))),
			db
				.select()
				.from(habitCompletions)
				.where(inRange(habitCompletions as never)),
			db
				.select()
				.from(financeEntries)
				.where(inRange(financeEntries as never)),
			db
				.select()
				.from(planItems)
				.where(inRange(planItems as never)),
			db
				.select()
				.from(weightEntries)
				.where(
					and(
						eq(weightEntries.userId, userId),
						lte(weightEntries.date, to),
						isNull(weightEntries.deletedAt)
					)
				),
			db
				.select()
				.from(dailyNutrition)
				.where(inRange(dailyNutrition as never)),
			db
				.select()
				.from(dailyFinance)
				.where(inRange(dailyFinance as never))
		]);

	return {
		foods: foods as unknown as FoodEntry[],
		habits: habitRows as unknown as Habit[],
		completions: completions as unknown as HabitCompletion[],
		finance: finance as unknown as FinanceEntry[],
		plan: plan as unknown as PlanItem[],
		weights: weights as unknown as WeightEntry[],
		calorieGoals: Object.fromEntries(nutritionRows.map((row) => [row.date, row.calorieGoal])),
		budgets: Object.fromEntries(budgetRows.map((row) => [row.date, row.budget]))
	};
}
