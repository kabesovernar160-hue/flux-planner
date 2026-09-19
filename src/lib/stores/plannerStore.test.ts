import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '$lib/db/localDb';
import { resetDriverForTests } from '$lib/db/storage';
import { addDays, getToday } from '$lib/utils/date';
import { PlannerStore } from './plannerStore.svelte';

let store: PlannerStore;
const today = () => getToday();

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();
	store = new PlannerStore();
});

afterEach(() => {
	// Снимаем таймер полуночи: иначе он удержит процесс после теста.
	store.dispose();
});

const food = (calories: number, extra: Partial<Parameters<PlannerStore['addFoodEntry']>[0]> = {}) =>
	store.addFoodEntry({
		name: 'Еда',
		calories,
		protein: 10,
		fat: 5,
		carbs: 20,
		source: 'manual',
		...extra
	});

describe('начальное состояние', () => {
	it('пустое и безопасное', () => {
		expect(store.foodEntries).toEqual([]);
		expect(store.habits).toEqual([]);
		expect(store.financeEntries).toEqual([]);
		expect(store.status).toBe('idle');
		expect(store.currentDate).toBe(today());
	});

	it('производные значения не NaN до загрузки данных', () => {
		expect(store.caloriesConsumed).toBe(0);
		expect(store.calorieProgress).toBe(0);
		expect(store.habitCompletionProgress).toBe(0);
		expect(store.dailyBudgetProgress).toBe(0);
	});
});

describe('питание', () => {
	it('добавление еды пересчитывает съеденное и остаток', () => {
		food(400);
		food(610);

		expect(store.caloriesConsumed).toBe(1010);
		expect(store.caloriesRemaining).toBe(store.todayNutrition.calorieGoal - 1010);
		expect(store.todayFoods).toHaveLength(2);
	});

	it('макросы суммируются', () => {
		food(400);
		food(400);

		expect(store.proteinConsumed).toBe(20);
		expect(store.fatConsumed).toBe(10);
		expect(store.carbsConsumed).toBe(40);
	});

	it('еда другого дня не попадает в сегодняшние итоги', () => {
		food(500, { date: addDays(today(), -1) });

		expect(store.caloriesConsumed).toBe(0);
		expect(store.foodEntries).toHaveLength(1);
	});

	it('удаление пересчитывает итоги', () => {
		const entry = food(400);
		food(200);
		store.removeFoodEntry(entry.id);

		expect(store.caloriesConsumed).toBe(200);
	});

	it('правка записи пересчитывает итоги', () => {
		const entry = food(400);
		store.updateFoodEntry(entry.id, { calories: 700 });

		expect(store.caloriesConsumed).toBe(700);
	});

	it('удаление несуществующей записи ничего не ломает', () => {
		food(400);
		expect(() => store.removeFoodEntry('нет-такого')).not.toThrow();
		expect(store.caloriesConsumed).toBe(400);
	});

	it('перебор даёт отрицательный остаток и флаг превышения', () => {
		store.setCalorieGoal(1000);
		food(1300);

		expect(store.caloriesRemaining).toBe(-300);
		expect(store.isOverCalorieGoal).toBe(true);
		expect(store.calorieProgress).toBeGreaterThan(1);
	});

	it('нулевая цель даёт прогресс 0, а не деление на ноль', () => {
		store.setCalorieGoal(0);
		food(500);

		expect(store.calorieProgress).toBe(0);
		expect(Number.isFinite(store.calorieProgress)).toBe(true);
	});
});

describe('вода', () => {
	it('накапливается', () => {
		store.addWater(250);
		store.addWater(250);

		expect(store.todayNutrition.waterConsumedMl).toBe(500);
	});

	it('убавляется, но не уходит ниже нуля', () => {
		store.addWater(250);
		store.removeWater(500);

		expect(store.todayNutrition.waterConsumedMl).toBe(0);
	});

	it('игнорирует бессмысленные объёмы', () => {
		store.addWater(250);
		store.addWater(-100);
		store.addWater(Number.NaN);

		expect(store.todayNutrition.waterConsumedMl).toBe(250);
	});

	it('доля считается от цели', () => {
		store.setWaterGoal(2000);
		store.addWater(500);

		expect(store.waterProgress).toBe(0.25);
	});
});

describe('привычки', () => {
	const makeHabit = (name = 'Зарядка') =>
		store.createHabit({ name, icon: 'barbell', frequency: 'daily' });

	it('создаются и попадают в сегодняшние', () => {
		makeHabit();
		expect(store.todayHabits).toHaveLength(1);
		expect(store.completedHabits).toHaveLength(0);
	});

	it('переключаются в обе стороны', () => {
		const habit = makeHabit();

		expect(store.toggleHabit(habit.id)).toBe(true);
		expect(store.isHabitCompleted(habit.id)).toBe(true);
		expect(store.completedHabits).toHaveLength(1);

		expect(store.toggleHabit(habit.id)).toBe(false);
		expect(store.isHabitCompleted(habit.id)).toBe(false);
	});

	it('повторное выполнение не создаёт вторую отметку', () => {
		const habit = makeHabit();
		store.completeHabit(habit.id);
		store.completeHabit(habit.id);

		expect(store.habitCompletions).toHaveLength(1);
	});

	it('прогресс считается от запланированных на день', () => {
		const a = makeHabit('A');
		makeHabit('B');
		store.completeHabit(a.id);

		expect(store.habitCompletionProgress).toBe(0.5);
	});

	it('без привычек прогресс 0, а не NaN', () => {
		expect(store.habitCompletionProgress).toBe(0);
	});

	it('архивная привычка выпадает из сегодняшних, но история остаётся', () => {
		const habit = makeHabit();
		store.completeHabit(habit.id);
		store.archiveHabit(habit.id);

		expect(store.todayHabits).toHaveLength(0);
		expect(store.habitCompletions).toHaveLength(1);

		store.restoreHabit(habit.id);
		expect(store.todayHabits).toHaveLength(1);
	});

	it('weekdays не планируется на выходные', () => {
		const habit = store.createHabit({ name: 'Работа', icon: 'pen', frequency: 'weekdays' });

		// 2026-01-03 — суббота, 2026-01-05 — понедельник.
		store.setDate('2026-01-03');
		expect(store.todayHabits.map((h) => h.id)).not.toContain(habit.id);

		store.setDate('2026-01-05');
		expect(store.todayHabits.map((h) => h.id)).toContain(habit.id);
	});

	it('custom учитывает только указанные дни недели', () => {
		const habit = store.createHabit({
			name: 'Бассейн',
			icon: 'drop',
			frequency: 'custom',
			targetDays: [2, 4] // вторник и четверг
		});

		store.setDate('2026-01-06'); // вторник
		expect(store.todayHabits.map((h) => h.id)).toContain(habit.id);

		store.setDate('2026-01-07'); // среда
		expect(store.todayHabits.map((h) => h.id)).not.toContain(habit.id);
	});

	it('custom без списка дней не планируется никогда', () => {
		store.createHabit({ name: 'Без расписания', icon: 'check', frequency: 'custom' });
		expect(store.todayHabits).toHaveLength(0);
	});

	it('удаление привычки уносит её отметки', () => {
		const habit = makeHabit();
		store.completeHabit(habit.id);
		store.deleteHabit(habit.id);

		expect(store.habits).toHaveLength(0);
		expect(store.habitCompletions).toHaveLength(0);
	});

	it('отметки не привязаны к «сегодня» и переживают смену дня', () => {
		const habit = makeHabit();
		const yesterday = addDays(today(), -1);

		store.completeHabit(habit.id, yesterday);

		// Сегодня не выполнена, вчера выполнена — история никуда не делась.
		expect(store.isHabitCompleted(habit.id, today())).toBe(false);
		expect(store.isHabitCompleted(habit.id, yesterday)).toBe(true);
	});
});

describe('финансы', () => {
	const expense = (amount: number, category: 'food' | 'transport' = 'food', date?: string) =>
		store.addFinanceEntry({ type: 'expense', amount, category, date });

	it('расходы суммируются', () => {
		expense(920);
		expense(480, 'transport');

		expect(store.dailySpent).toBe(1400);
		expect(store.todayExpenses).toHaveLength(2);
	});

	it('доходы считаются отдельно и дают баланс', () => {
		expense(1000);
		store.addFinanceEntry({ type: 'income', amount: 2500, category: 'other' });

		expect(store.dailyIncome).toBe(2500);
		expect(store.dailySpent).toBe(1000);
		expect(store.dailyBalance).toBe(1500);
	});

	it('остаток бюджета уходит в минус при превышении', () => {
		store.setDailyBudget(1000);
		expense(1400);

		expect(store.dailyBudgetRemaining).toBe(-400);
		expect(store.isOverBudget).toBe(true);
		expect(store.dailyBudgetProgress).toBeCloseTo(1.4);
	});

	it('нулевой бюджет даёт прогресс 0, а не бесконечность', () => {
		store.setDailyBudget(0);
		expense(500);

		expect(store.dailyBudgetProgress).toBe(0);
		expect(Number.isFinite(store.dailyBudgetProgress)).toBe(true);
	});

	it('группировка по категориям', () => {
		expense(920);
		expense(300);
		expense(480, 'transport');

		expect(store.expensesByCategory.food).toBe(1220);
		expect(store.expensesByCategory.transport).toBe(480);
	});

	it('удаление и правка пересчитывают итоги', () => {
		const entry = expense(920);
		store.updateFinanceEntry(entry.id, { amount: 500 });
		expect(store.dailySpent).toBe(500);

		store.deleteFinanceEntry(entry.id);
		expect(store.dailySpent).toBe(0);
	});
});

describe('выбор даты', () => {
	it('производные значения следуют за выбранным днём', () => {
		const yesterday = addDays(today(), -1);
		food(400, { date: yesterday });
		food(700);

		expect(store.caloriesConsumed).toBe(700);

		store.setDate(yesterday);
		expect(store.caloriesConsumed).toBe(400);

		store.goToToday();
		expect(store.caloriesConsumed).toBe(700);
	});
});

describe('стрик', () => {
	/**
	 * Привычка с отмотанной назад датой создания.
	 *
	 * Движок стриков не заходит раньше дня создания: у привычки, заведённой
	 * сегодня, трёхдневной серии быть не может. Чтобы проверять историю,
	 * дату создания приходится сдвигать вручную — через публичный API
	 * её не изменить, и это правильно.
	 */
	function habitCreatedDaysAgo(days: number) {
		const habit = store.createHabit({ name: 'Зарядка', icon: 'barbell', frequency: 'daily' });
		const stored = store.habits.find((item) => item.id === habit.id)!;
		stored.createdAt = `${addDays(today(), -days)}T08:00:00.000Z`;
		return habit;
	}

	it('считает подряд идущие полностью выполненные дни', () => {
		const habit = habitCreatedDaysAgo(10);

		store.completeHabit(habit.id, today());
		store.completeHabit(habit.id, addDays(today(), -1));
		store.completeHabit(habit.id, addDays(today(), -2));

		expect(store.currentStreak).toBe(3);
	});

	it('незавершённый сегодняшний день не обнуляет вчерашний стрик', () => {
		const habit = habitCreatedDaysAgo(10);

		store.completeHabit(habit.id, addDays(today(), -1));
		store.completeHabit(habit.id, addDays(today(), -2));

		expect(store.currentStreak).toBe(2);
	});

	it('серия не заходит раньше дня создания привычки', () => {
		const habit = habitCreatedDaysAgo(1);

		store.completeHabit(habit.id, today());
		store.completeHabit(habit.id, addDays(today(), -1));
		// Отметка за позавчера есть, но привычки тогда ещё не существовало.
		store.completeHabit(habit.id, addDays(today(), -2));

		expect(store.currentStreak).toBe(2);
	});

	it('запоминает лучшую серию', () => {
		const habit = habitCreatedDaysAgo(20);

		for (const back of [10, 9, 8, 7]) store.completeHabit(habit.id, addDays(today(), -back));
		for (const back of [1, 0]) store.completeHabit(habit.id, addDays(today(), -back));

		expect(store.currentStreak).toBe(2);
		expect(store.longestStreak).toBe(4);
	});

	it('пропуск в середине обрывает счёт', () => {
		const habit = store.createHabit({ name: 'Зарядка', icon: 'barbell', frequency: 'daily' });

		store.completeHabit(habit.id, today());
		// Вчера пропущено.
		store.completeHabit(habit.id, addDays(today(), -2));

		expect(store.currentStreak).toBe(1);
	});

	it('без привычек стрик равен нулю', () => {
		expect(store.currentStreak).toBe(0);
	});
});

describe('гидратация и персистентность', () => {
	it('данные переживают пересоздание стора', async () => {
		food(400);
		store.createHabit({ name: 'Зарядка', icon: 'barbell', frequency: 'daily' });
		store.addFinanceEntry({ type: 'expense', amount: 920, category: 'food' });
		store.addWater(500);
		await store.flush();

		const restored = new PlannerStore();
		await restored.initialize();

		expect(restored.caloriesConsumed).toBe(400);
		expect(restored.habits).toHaveLength(1);
		expect(restored.dailySpent).toBe(920);
		expect(restored.todayNutrition.waterConsumedMl).toBe(500);

		restored.dispose();
	});

	it('после гидратации статус ready', async () => {
		await store.initialize();
		expect(store.status).toBe('ready');
	});

	it('повторный initialize не запускает вторую гидратацию', async () => {
		const first = store.initialize();
		const second = store.initialize();
		expect(first).toBe(second);
		await first;
	});

	it('сброс очищает и память, и хранилище', async () => {
		food(400);
		await store.flush();
		await store.reset();

		expect(store.foodEntries).toEqual([]);

		const restored = new PlannerStore();
		await restored.initialize();
		expect(restored.foodEntries).toEqual([]);

		restored.dispose();
	});

	it('удалённая запись не возвращается после перезагрузки', async () => {
		const entry = food(400);
		await store.flush();

		store.removeFoodEntry(entry.id);
		await store.flush();

		const restored = new PlannerStore();
		await restored.initialize();
		expect(restored.foodEntries).toEqual([]);

		restored.dispose();
	});
});
