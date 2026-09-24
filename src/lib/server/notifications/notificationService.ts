import { env } from '$env/dynamic/private';
import type { Db } from '../db/client';
import { loadDaySnapshot, loadPlannerSettings, loadRangeSnapshot } from '../db/queries';
import type { UserRow } from '../db/schema';
import { checkRateLimit } from '../rateLimit';
import { sendMessage, type SendMessageOptions } from '../telegram/botApi';
import { isValidMiniAppUrl } from '../telegram/botMessages';
import {
	addDays,
	dayOfWeek,
	formatDateKey,
	getHour,
	getToday,
	type DateKey
} from '$lib/utils/date';
import { calculateFinanceSummary } from '$lib/utils/finance';
import { scheduledHabits } from '$lib/utils/habitFrequency';
import { calculateNutritionSummary } from '$lib/utils/nutrition';
import { formatMoney as formatCurrency, formatWeight } from '$lib/utils/format';
import {
	buildWeekReport,
	weekBotLines,
	weekLabel,
	weekStartOf,
	type WeekReport
} from '$lib/utils/weekly';

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

	// Вес — только если сегодня взвешивались: строка «Вес: —» каждый вечер
	// быстро превращается в укор, а не в сводку.
	if (snapshot.weight) {
		lines.push(`Вес: ${formatWeight(snapshot.weight.weightKg)} кг`);
	}

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

export interface RunOptions {
	/**
	 * Местный час получателя, в который уместно писать.
	 *
	 * Планировщик один на всех, а часовые пояса у людей разные: рассылка,
	 * отправленная «в восемь вечера» по времени сервера, приходит кому-то
	 * в полдень, а кому-то в три ночи. С этим параметром планировщик
	 * дёргается раз в час, а сообщение получают только те, у кого сейчас
	 * нужное время.
	 *
	 * Без него рассылка уходит всем сразу — так вели себя прежние
	 * расписания, и ломать их молча нельзя.
	 */
	localHour?: number;
	now?: Date;
}

export interface RunResult {
	sent: number;
	skipped: number;
	failed: number;
}

/**
 * Пора ли писать этому человеку.
 *
 * Отдельная функция, потому что это единственное решение в рассылке, которое
 * можно проверить без сети: всё остальное там — обход списка и отправка.
 */
export function isLocalHour(timezone: string, localHour: number | undefined, now: Date): boolean {
	return localHour === undefined || getHour(now, timezone) === localHour;
}

async function runForUsers(
	users: UserRow[],
	options: RunOptions,
	send: (user: UserRow) => Promise<boolean>
): Promise<RunResult> {
	const now = options.now ?? new Date();
	let sent = 0;
	let skipped = 0;
	let failed = 0;

	for (const user of users) {
		// Ошибка отправки одному не должна останавливать остальных:
		// заблокировавший бота пользователь не повод лишить сводки всех прочих.
		try {
			if (!isLocalHour(user.timezone, options.localHour, now)) {
				skipped += 1;
				continue;
			}

			const delivered = await send(user);
			if (delivered) sent += 1;
			else skipped += 1;
		} catch (error) {
			failed += 1;
			console.error(`[notifications] пользователь ${user.id}`, error);
		}
	}

	return { sent, skipped, failed };
}

/** Итоги дня: что съедено, выпито, сделано и потрачено. */
export async function runDailyNotifications(
	db: Db,
	users: UserRow[],
	options: RunOptions = {}
): Promise<RunResult> {
	return runForUsers(users, options, (user) => sendDailySummary(db, user));
}

/**
 * Напоминание о незакрытых привычках.
 *
 * Отдельным заходом, а не строкой в итогах дня: напоминание полезно днём,
 * когда что-то ещё можно успеть, а итоги — вечером, когда день закрыт.
 */
export async function runHabitReminders(
	db: Db,
	users: UserRow[],
	options: RunOptions = {}
): Promise<RunResult> {
	return runForUsers(users, options, (user) => sendHabitReminder(db, user));
}

/**
 * Предупреждение о подходящем лимите трат.
 *
 * Молчит, пока израсходовано меньше девяти десятых: сообщение «потрачено
 * 300 из 3000» — это не предупреждение, а шум, от которого отключают
 * уведомления целиком.
 */
export async function runBudgetWarnings(
	db: Db,
	users: UserRow[],
	options: RunOptions = {}
): Promise<RunResult> {
	return runForUsers(users, options, (user) => sendBudgetWarning(db, user));
}

/* ───────────────── Итоги недели ───────────────── */

/**
 * Когда приходят итоги недели: воскресенье, 19:00 по местному времени.
 *
 * На час раньше итогов дня: два сообщения в одну минуту читаются как спам,
 * а вечер воскресенья — время, когда неделю уже можно подвести, а на
 * следующую ещё хочется что-то запланировать.
 */
export const WEEKLY_REPORT_HOUR = 19;

/**
 * Пора ли присылать итоги недели.
 *
 * Итоги едут в том же ежечасном вызове, что и итоги дня, — отдельного
 * расписания нет. Параметр hour вызова относится к итогам дня; у недели
 * свой час. Без hour (прежние расписания «всем сразу» раз в день) итоги
 * уходят в тот вызов, что пришёлся на воскресенье по местному времени.
 */
export function isWeeklyReportTime(
	timezone: string,
	localHour: number | undefined,
	now: Date
): boolean {
	const localDate = formatDateKey(now, timezone);
	if (dayOfWeek(localDate) !== 0) return false;

	return localHour === undefined || getHour(now, timezone) === WEEKLY_REPORT_HOUR;
}

export interface WeeklyMessage {
	text: string;
	start: DateKey;
	report: WeekReport;
	/** Ноль записей за неделю — писать не о чем. */
	hasData: boolean;
}

/**
 * Итоги недели для бота.
 *
 * Считаются теми же функциями, что и экран /week, по записям с сервера.
 * Прошлая неделя грузится вместе с текущей: без сравнения «86 %» — число
 * в вакууме.
 */
export async function buildWeeklyMessage(
	db: Db,
	user: UserRow,
	now: Date = new Date(),
	settings?: unknown
): Promise<WeeklyMessage> {
	const start = weekStartOf(formatDateKey(now, user.timezone));
	const previousStart = addDays(start, -7);

	const [snapshot, resolvedSettings] = await Promise.all([
		loadRangeSnapshot(db, user.id, previousStart, addDays(start, 6)),
		settings === undefined ? loadPlannerSettings(db, user.id) : Promise.resolve(settings)
	]);

	const goals = readSummaryGoals(resolvedSettings);
	const source = (resolvedSettings ?? {}) as { currency?: unknown; locale?: unknown };
	const currency = typeof source.currency === 'string' ? source.currency : 'RUB';
	const locale = typeof source.locale === 'string' ? source.locale : 'ru-RU';

	const data = {
		foodEntries: snapshot.foods,
		habits: snapshot.habits,
		completions: snapshot.completions,
		financeEntries: snapshot.finance,
		planItems: snapshot.plan,
		weightEntries: snapshot.weights,
		calorieGoals: snapshot.calorieGoals,
		budgets: snapshot.budgets,
		defaultCalorieGoal: goals.calorieGoal,
		defaultBudget: goals.dailyBudget
	};

	const report = buildWeekReport(data, start, formatDateKey(now, user.timezone));
	const previous = buildWeekReport(data, previousStart);

	const lines = weekBotLines(report, previous, (value) => formatCurrency(value, currency, locale));

	return {
		start,
		report,
		hasData: report.activeDays > 0,
		text: [`Итоги недели, ${weekLabel(start)}`, '', ...lines].join('\n')
	};
}

/** Кнопка «Открыть итоги»: Mini App сразу на экране недели. */
export function weeklyReportKeyboard(miniAppUrl: string | undefined) {
	if (!isValidMiniAppUrl(miniAppUrl)) return undefined;

	const url = `${(miniAppUrl as string).replace(/\/+$/, '')}/week`;
	return { inline_keyboard: [[{ text: '📊 Открыть итоги', web_app: { url } }]] };
}

type WeeklySend = (chatId: string, text: string, options: SendMessageOptions) => Promise<void>;

export interface WeeklyOptions {
	now?: Date;
	send?: WeeklySend;
	botToken?: string;
	miniAppUrl?: string;
}

export async function sendWeeklyReport(
	db: Db,
	user: UserRow,
	options: WeeklyOptions = {}
): Promise<boolean> {
	const now = options.now ?? new Date();

	// Тот же переключатель, что у итогов дня: человек, отключивший сводки,
	// выключил сообщения бота по расписанию, а не одно из них.
	const settings = await loadPlannerSettings(db, user.id);
	if (!dailySummaryEnabled(settings)) return false;

	const message = await buildWeeklyMessage(db, user, now, settings);

	// Неделя без единой записи — не повод писать: итоги из нулей
	// читаются как упрёк, а не как напоминание.
	if (!message.hasData) return false;

	// Защита от повторного вызова планировщика в тот же час: одна неделя —
	// одно сообщение. Счётчик частоты уже живёт в базе и переживает рестарты.
	const once = await checkRateLimit(
		`weekly:${user.id}:${message.start}`,
		1,
		8 * 24 * 60 * 60 * 1000,
		{
			db,
			now: now.getTime()
		}
	);
	if (!once.allowed) return false;

	const botToken = options.botToken ?? env.TELEGRAM_BOT_TOKEN?.trim();
	const replyMarkup = weeklyReportKeyboard(options.miniAppUrl ?? env.TELEGRAM_MINI_APP_URL?.trim());

	if (!botToken && !options.send) {
		// Локальная разработка: отправлять некуда, но видеть текст полезно.
		console.info(
			`[notifications] итоги недели для ${user.telegramUserId} (нет токена бота):\n${message.text}`
		);
		return true;
	}

	await (options.send ?? sendMessage)(user.telegramUserId, message.text, { replyMarkup });
	return true;
}

/**
 * Итоги недели в ежечасном проходе планировщика.
 *
 * Отдельного расписания нет: функция вызывается из того же cron, что и итоги
 * дня, и сама решает, у кого сейчас вечер воскресенья.
 */
export async function runWeeklyReports(
	db: Db,
	users: UserRow[],
	options: RunOptions & Omit<WeeklyOptions, 'now'> = {}
): Promise<RunResult> {
	const now = options.now ?? new Date();
	let sent = 0;
	let skipped = 0;
	let failed = 0;

	for (const user of users) {
		try {
			if (!isWeeklyReportTime(user.timezone, options.localHour, now)) {
				skipped += 1;
				continue;
			}

			const delivered = await sendWeeklyReport(db, user, { ...options, now });
			if (delivered) sent += 1;
			else skipped += 1;
		} catch (error) {
			failed += 1;
			console.error(`[notifications] итоги недели, пользователь ${user.id}`, error);
		}
	}

	return { sent, skipped, failed };
}
