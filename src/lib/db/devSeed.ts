import type { PlannerStoreLike } from '$lib/stores/plannerStore.svelte';
import { addDays, getToday } from '$lib/utils/date';

/**
 * DEVELOPMENT ONLY.
 *
 * Наполняет пустое хранилище правдоподобными данными, чтобы дашборд было
 * на чём смотреть при локальной разработке. В продакшене не вызывается:
 * подсовывать пользователю чужие траты и съеденное недопустимо.
 *
 * Сид срабатывает ровно один раз — только если хранилище действительно пустое.
 * Иначе он затирал бы то, что пользователь ввёл сам.
 */
export function seedDevData(store: PlannerStoreLike): boolean {
	const isEmpty =
		store.foodEntries.length === 0 &&
		store.habits.length === 0 &&
		store.financeEntries.length === 0;

	if (!isEmpty) return false;

	const today = getToday(store.doc.user.timezone);

	// Питание: 1450 из 2100 ккал, то есть «осталось 650».
	store.addFoodEntry({
		name: 'Овсянка с ягодами',
		grams: 320,
		calories: 420,
		protein: 14,
		fat: 9,
		carbs: 68,
		source: 'manual',
		date: today
	});
	store.addFoodEntry({
		name: 'Куриная грудка с рисом',
		grams: 380,
		calories: 610,
		protein: 48,
		fat: 12,
		carbs: 72,
		source: 'manual',
		date: today
	});
	store.addFoodEntry({
		name: 'Греческий йогурт',
		grams: 200,
		calories: 420,
		protein: 20,
		fat: 27,
		carbs: 25,
		source: 'manual',
		date: today
	});

	store.addWater(1400, today);

	// Привычки: шесть штук, четыре выполнены.
	const habits = [
		{ name: 'Зарядка', icon: 'barbell', done: true },
		{ name: 'Выпить 2,5 л воды', icon: 'drop', done: false },
		{ name: 'Чтение 20 минут', icon: 'book', done: true },
		{ name: 'Витамины', icon: 'pill', done: true },
		{ name: 'Прогулка', icon: 'footprints', done: true },
		{ name: 'Без телефона после 23:00', icon: 'moon', done: false }
	] as const;

	const HISTORY_DAYS = 5;

	for (const item of habits) {
		const habit = store.createHabit({ name: item.name, icon: item.icon, frequency: 'daily' });

		// Дату создания отматываем назад вместе с историей отметок.
		// Движок стриков намеренно не заходит раньше дня создания привычки,
		// поэтому сид с сегодняшней датой создания и отметками за прошлую
		// неделю дал бы нулевую серию — данные были бы несогласованными.
		const stored = store.habits.find((entry) => entry.id === habit.id);
		if (stored) stored.createdAt = `${addDays(today, -HISTORY_DAYS)}T08:00:00.000Z`;

		if (item.done) store.completeHabit(habit.id, today);

		// Полностью закрытые предыдущие дни, чтобы серия была видна.
		// Сегодня закрыто не всё, поэтому счётчик покажет HISTORY_DAYS.
		for (let back = 1; back <= HISTORY_DAYS; back++) {
			store.completeHabit(habit.id, addDays(today, -back));
		}
	}

	// Финансы: категории в сумме дают дневные траты — 920 + 480 + 440 = 1840.
	const expenses = [
		{ category: 'food', amount: 920, note: 'Продукты' },
		{ category: 'transport', amount: 480, note: 'Такси' },
		{ category: 'subscriptions', amount: 440, note: 'Связь' }
	] as const;

	for (const expense of expenses) {
		store.addFinanceEntry({
			type: 'expense',
			amount: expense.amount,
			category: expense.category,
			note: expense.note,
			date: today
		});
	}

	// Несколько прошлых дней, чтобы у графика трат была история.
	const history = [2100, 1450, 3200, 980, 2650, 1720];
	history.forEach((amount, index) => {
		store.addFinanceEntry({
			type: 'expense',
			amount,
			category: 'other',
			date: addDays(today, index - history.length)
		});
	});

	return true;
}
