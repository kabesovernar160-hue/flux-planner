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

/**
 * Запасные цели.
 *
 * Те же числа, что у нового пользователя в приложении. Нужны только когда
 * человек ещё ничего не настраивал: во всех остальных случаях цели берутся
 * из его настроек.
 */
const DEFAULTS = {
	calorieGoal: 2100,
	proteinGoal: 120,
	fatGoal: 70,
	carbsGoal: 230,
	waterGoalMl: 2500,
	dailyBudget: 3000
};

export type SummaryGoals = typeof DEFAULTS;

/**
 * Цели пользователя из его настроек.
 *
 * Настройки приходят JSON-блобом: форму задаёт клиент, и сервер обязан
 * пережить любую. Каждое поле берётся по отдельности — половина настроек
 * лучше, чем откат на общие константы целиком.
 *
 * Без этого бот писал «из 2100 ккал» и «лимит 3000 ₽» человеку, у которого
 * в приложении стоят совсем другие числа: сводка расходилась с экраном,
 * а доверие к ней — с ней самой.
 */
export function readSummaryGoals(settings: unknown): SummaryGoals {
	if (typeof settings !== 'object' || settings === null) return DEFAULTS;

	const source = settings as Record<string, unknown>;

	const pick = (key: keyof SummaryGoals): number => {
		const value = source[key];
		// Ноль и отрицательные значения отбрасываются: делить на них нельзя,
		// а «цель 0 ккал» означает не цель, а испорченную настройку.
		return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULTS[key];
	};

	return {
		calorieGoal: pick('calorieGoal'),
		proteinGoal: pick('proteinGoal'),
		fatGoal: pick('fatGoal'),
		carbsGoal: pick('carbsGoal'),
		waterGoalMl: pick('waterGoalMl'),
		dailyBudget: pick('dailyBudget')
	};
}

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
	date = getToday(user.timezone),
	/** Настройки, если вызывающий их уже прочитал: рассылка не читает строку дважды. */
	settings?: unknown
): Promise<DailySummary> {
	const [snapshot, resolvedSettings] = await Promise.all([
		loadDaySnapshot(db, user.id, date),
		settings === undefined ? loadPlannerSettings(db, user.id) : Promise.resolve(settings)
	]);

	const goals = readSummaryGoals(resolvedSettings);

	const nutrition = snapshot.nutrition ?? {
		date,
		calorieGoal: goals.calorieGoal,
		proteinGoal: goals.proteinGoal,
		fatGoal: goals.fatGoal,
		carbsGoal: goals.carbsGoal,
		waterGoalMl: goals.waterGoalMl,
		waterConsumedMl: 0
	};

	const food = calculateNutritionSummary(snapshot.foods, nutrition);
	const finance = calculateFinanceSummary(
		snapshot.finance,
		date,
		snapshot.budget?.budget ?? goals.dailyBudget
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
	const settings = await loadPlannerSettings(db, user.id);
	if (!dailySummaryEnabled(settings)) return false;

	const summary = await buildDailySummary(db, user, date, settings);

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
