import type { Db } from '../db/client';
import { loadDaySnapshot, loadPlannerSettings } from '../db/queries';
import type { UserRow } from '../db/schema';
import { sendMessage } from '../telegram/botApi';
import { getToday } from '$lib/utils/date';
import { calculateFinanceSummary } from '$lib/utils/finance';
import { scheduledHabits } from '$lib/utils/habitFrequency';
import { calculateNutritionSummary } from '$lib/utils/nutrition';

/**
 * Сборка и отправка уведомлений.
 *
 * Расчёты берутся из тех же чистых функций, что использует интерфейс.
 * Своя арифметика здесь означала бы, что сводка в чате однажды разойдётся
 * с тем, что человек видит на экране.
 */

const DEFAULTS = {
	calorieGoal: 2100,
	proteinGoal: 120,
	fatGoal: 70,
	carbsGoal: 230,
	waterGoalMl: 2500,
	dailyBudget: 3000
};

function formatMl(ml: number): string {
	return (ml / 1000).toFixed(1).replace('.', ',');
}

function formatMoney(value: number): string {
	return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

export interface DailySummary {
	text: string;
	hasData: boolean;
}

/**
 * Текст ежедневной сводки.
 *
 * Возвращается отдельно от отправки, чтобы его можно было проверить тестом,
 * не поднимая сеть и не тратя вызовы Bot API.
 */
export async function buildDailySummary(
	db: Db,
	user: UserRow,
	date = getToday(user.timezone)
): Promise<DailySummary> {
	const snapshot = await loadDaySnapshot(db, user.id, date);

	const nutrition = snapshot.nutrition ?? {
		date,
		calorieGoal: DEFAULTS.calorieGoal,
		proteinGoal: DEFAULTS.proteinGoal,
		fatGoal: DEFAULTS.fatGoal,
		carbsGoal: DEFAULTS.carbsGoal,
		waterGoalMl: DEFAULTS.waterGoalMl,
		waterConsumedMl: 0
	};

	const food = calculateNutritionSummary(snapshot.foods, nutrition);
	const finance = calculateFinanceSummary(
		snapshot.finance,
		date,
		snapshot.budget?.budget ?? DEFAULTS.dailyBudget
	);

	const planned = scheduledHabits(snapshot.habits, date);
	const doneIds = new Set(
		snapshot.completions.filter((item) => item.completed).map((item) => item.habitId)
	);
	const doneCount = planned.filter((habit) => doneIds.has(habit.id)).length;

	const hasData =
		snapshot.foods.length > 0 || snapshot.finance.length > 0 || snapshot.completions.length > 0;

	const lines = [
		`Итоги дня, ${date}`,
		'',
		`Калории: ${Math.round(food.totals.calories)} из ${Math.round(food.goals.calories)}`,
		`Вода: ${formatMl(food.water.consumedMl)} из ${formatMl(food.water.goalMl)} л`,
		`Привычки: ${doneCount} из ${planned.length}`,
		`Траты: ${formatMoney(finance.spent)} из ${formatMoney(finance.budget)}`
	];

	if (finance.isOverBudget) {
		lines.push('', `Лимит превышен на ${formatMoney(-finance.remaining)}.`);
	}

	return { text: lines.join('\n'), hasData };
}

/**
 * Включены ли итоги дня.
 *
 * Настройки приходят из planner_state JSON-блобом: сервер не знает их форму
 * и не должен падать на чужой. Отсутствие настройки означает «включено» —
 * у тех, кто пользовался приложением до появления переключателя, поведение
 * не меняется молча.
 */
export function dailySummaryEnabled(settings: unknown): boolean {
	if (typeof settings !== 'object' || settings === null) return true;

	const notifications = (settings as { notifications?: unknown }).notifications;
	if (typeof notifications !== 'object' || notifications === null) return true;

	return (notifications as { dailySummary?: unknown }).dailySummary !== false;
}

export async function sendDailySummary(db: Db, user: UserRow, date?: string): Promise<boolean> {
	// Отключённые уведомления проверяются до сборки сводки: незачем читать
	// день целиком, чтобы потом ничего не отправить.
	if (!dailySummaryEnabled(await loadPlannerSettings(db, user.id))) return false;

	const summary = await buildDailySummary(db, user, date);

	// Пустой день не тревожим: сводка из одних нулей — это спам,
	// а не полезное напоминание.
	if (!summary.hasData) return false;

	await sendMessage(user.telegramUserId, summary.text);
	return true;
}

export async function sendHabitReminder(
	db: Db,
	user: UserRow,
	date = getToday(user.timezone)
): Promise<boolean> {
	const snapshot = await loadDaySnapshot(db, user.id, date);
	const planned = scheduledHabits(snapshot.habits, date);

	if (planned.length === 0) return false;

	const doneIds = new Set(
		snapshot.completions.filter((item) => item.completed).map((item) => item.habitId)
	);
	const pending = planned.filter((habit) => !doneIds.has(habit.id));

	// Всё закрыто — напоминать не о чем.
	if (pending.length === 0) return false;

	const names = pending.slice(0, 5).map((habit) => `• ${habit.name}`);
	const tail = pending.length > 5 ? `\n…и ещё ${pending.length - 5}` : '';

	await sendMessage(user.telegramUserId, `Осталось на сегодня:\n${names.join('\n')}${tail}`);
	return true;
}

export async function sendBudgetWarning(
	db: Db,
	user: UserRow,
	date = getToday(user.timezone),
	threshold = 0.9
): Promise<boolean> {
	const snapshot = await loadDaySnapshot(db, user.id, date);
	const finance = calculateFinanceSummary(
		snapshot.finance,
		date,
		snapshot.budget?.budget ?? DEFAULTS.dailyBudget
	);

	if (finance.budget <= 0) return false;
	if (finance.progress < threshold * 100) return false;

	const text = finance.isOverBudget
		? `Дневной лимит превышен на ${formatMoney(-finance.remaining)}.`
		: `Потрачено ${formatMoney(finance.spent)} из ${formatMoney(finance.budget)}. Осталось ${formatMoney(finance.remaining)}.`;

	await sendMessage(user.telegramUserId, text);
	return true;
}

/**
 * Обход всех пользователей для ежедневной рассылки.
 *
 * Ошибка отправки одному не должна останавливать остальных: заблокировавший
 * бота пользователь не повод лишить сводки всех прочих.
 */
export async function runDailyNotifications(
	db: Db,
	users: UserRow[]
): Promise<{ sent: number; skipped: number; failed: number }> {
	let sent = 0;
	let skipped = 0;
	let failed = 0;

	for (const user of users) {
		try {
			const delivered = await sendDailySummary(db, user);
			if (delivered) sent += 1;
			else skipped += 1;
		} catch (error) {
			failed += 1;
			console.error(`[notifications] пользователь ${user.id}`, error);
		}
	}

	return { sent, skipped, failed };
}
