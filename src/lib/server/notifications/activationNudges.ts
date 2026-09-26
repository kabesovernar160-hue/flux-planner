import { and, eq, gt, isNull } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { anonymousTelegramId } from '../account/deleteAccount';
import type { Db } from '../db/client';
import { loadPlannerSettings } from '../db/queries';
import {
	activationNudges,
	dailyNutrition,
	financeEntries,
	foodEntries,
	habitCompletions,
	habits,
	planItems,
	weightEntries,
	type UserRow
} from '../db/schema';
import { BotApiError, sendMessage, type SendMessageOptions } from '../telegram/botApi';
import { FIRST_NUDGE_TEXT, SECOND_NUDGE_TEXT, tryExamplesKeyboard } from '../telegram/botMessages';
import { addDays, formatDateKey, getHour } from '$lib/utils/date';
import { dailySummaryEnabled } from './notificationService';

/**
 * Напоминания новичкам, которые так и не сделали первую запись.
 *
 * Из новичков недели большинство либо нажали «Начать» и не открыли
 * приложение, либо открыли и ничего не записали. Два мягких сообщения
 * с кнопкой-примером — самый дешёвый способ довести их до первой записи.
 *
 * Правила жёсткие, потому что лишнее сообщение от бота стоит дороже
 * пропущенного: за всю жизнь аккаунта не больше двух, ни одного после
 * любой записи, после блокировки бота и после удаления аккаунта.
 */

export type NudgeKind = 'first' | 'second';

/** Первое — через час после знакомства: человек ещё помнит, зачем пришёл. */
export const FIRST_NUDGE_DELAY_MS = 60 * 60 * 1000;

/**
 * Дальше первое не отправляется.
 *
 * Сутки с запасом на неровный планировщик: при единственном вызове в день
 * (Vercel Hobby) окно в 25 часов гарантированно ловит один проход,
 * и напоминание приходит «тем же вечером» или на следующий день.
 */
export const FIRST_NUDGE_MAX_AGE_MS = 25 * 60 * 60 * 1000;

/** Местные часы, когда уместно первое: с 9:00 до 21:59. Ночью — ждёт утра. */
export const FIRST_NUDGE_HOURS = { from: 9, to: 21 } as const;

/** Второе — на третий день знакомства, днём: с 12:00 до 20:59. */
export const SECOND_NUDGE_DAY_OFFSET = 2;
export const SECOND_NUDGE_HOURS = { from: 12, to: 20 } as const;

/**
 * Между напоминаниями не меньше полусуток.
 *
 * Первое могло задержаться до утра второго дня, и без паузы второе пришло
 * бы в тот же день — два сообщения подряд от молчащего бота читаются
 * как навязчивость.
 */
export const MIN_GAP_BETWEEN_NUDGES_MS = 12 * 60 * 60 * 1000;

/**
 * Пояс, если человек его не задавал.
 *
 * Колонка users.timezone по умолчанию 'UTC', и пока её ничто не меняет.
 * Аудитория приложения русскоязычная: полдень по Москве точнее попадает
 * в день человека, чем полдень по Гринвичу, который в Москве — три часа дня,
 * а «девять вечера по UTC» — полночь.
 */
export const DEFAULT_NUDGE_TIMEZONE = 'Europe/Moscow';

/**
 * Пауза между отправками.
 *
 * Bot API пропускает около 30 сообщений в секунду на бота, держимся
 * ниже — 25. Отправки и так идут по одной, пауза лишь не даёт
 * быстрой сети упереться в предел и получить 429 посреди прохода.
 */
export const SEND_INTERVAL_MS = Math.ceil(1000 / 25);

export interface NudgeState {
	firstSentAt: string | null;
	secondSentAt: string | null;
	blockedAt: string | null;
}

export function nudgeTimezone(timezone: string | null | undefined): string {
	return !timezone || timezone === 'UTC' ? DEFAULT_NUDGE_TIMEZONE : timezone;
}

function inHours(hour: number, window: { from: number; to: number }): boolean {
	return hour >= window.from && hour <= window.to;
}

/**
 * Какое напоминание пора отправить — только по времени и отметкам.
 *
 * Чистая функция без базы и сети: всё решение «писать или нет» по часам
 * проверяется тестом. Есть ли у человека записи, решает вызывающий код —
 * это запрос, и делать его для тех, кому по времени ничего не положено,
 * незачем.
 */
export function pickNudge(input: {
	/** Знакомство с ботом: момент, когда завелась учётная запись. */
	createdAt: string;
	timezone: string;
	now: Date;
	state: NudgeState | null;
}): NudgeKind | null {
	const { state, now } = input;
	if (state?.blockedAt) return null;

	const contact = new Date(input.createdAt);
	if (Number.isNaN(contact.getTime())) return null;

	const timezone = nudgeTimezone(input.timezone);
	const hour = getHour(now, timezone);
	const age = now.getTime() - contact.getTime();

	if (
		!state?.firstSentAt &&
		!state?.secondSentAt &&
		age >= FIRST_NUDGE_DELAY_MS &&
		age < FIRST_NUDGE_MAX_AGE_MS &&
		inHours(hour, FIRST_NUDGE_HOURS)
	) {
		return 'first';
	}

	if (state?.secondSentAt) return null;

	const secondDay = addDays(formatDateKey(contact, timezone), SECOND_NUDGE_DAY_OFFSET);
	if (formatDateKey(now, timezone) !== secondDay) return null;
	if (!inHours(hour, SECOND_NUDGE_HOURS)) return null;

	if (state?.firstSentAt) {
		const sinceFirst = now.getTime() - new Date(state.firstSentAt).getTime();
		if (sinceFirst < MIN_GAP_BETWEEN_NUDGES_MS) return null;
	}

	return 'second';
}

/**
 * Есть ли у человека хоть одна запись — любая и когда-либо.
 *
 * Надгробия считаются: запись, которую человек сделал и удалил, — всё равно
 * сделанная запись, и объяснять ему, как записывать, уже поздно. Вода
 * в счёт идёт, цели дня — нет: их заводит само приложение.
 */
export async function hasAnyRecord(db: Db, userId: string): Promise<boolean> {
	for (const table of [
		foodEntries,
		financeEntries,
		planItems,
		habits,
		habitCompletions,
		weightEntries
	]) {
		const [row] = await db
			.select({ id: table.id })
			.from(table)
			.where(eq(table.userId, userId))
			.limit(1);

		if (row) return true;
	}

	const [water] = await db
		.select({ id: dailyNutrition.id })
		.from(dailyNutrition)
		.where(and(eq(dailyNutrition.userId, userId), gt(dailyNutrition.waterConsumedMl, 0)))
		.limit(1);

	return Boolean(water);
}

/** Удалённый аккаунт обезличен, и писать по нему некому. */
export function isDeletedUser(user: Pick<UserRow, 'id' | 'telegramUserId'>): boolean {
	return user.telegramUserId === anonymousTelegramId(user.id);
}

async function loadStates(db: Db): Promise<Map<string, NudgeState>> {
	const rows = await db.select().from(activationNudges);
	return new Map(rows.map((row) => [row.userId, row]));
}

function sentColumn(kind: NudgeKind) {
	return kind === 'first' ? activationNudges.firstSentAt : activationNudges.secondSentAt;
}

/**
 * Занять отправку.
 *
 * Отметка ставится до отправки условным UPDATE: из двух одновременных
 * вызовов планировщика строку изменит только один, и только он напишет.
 * Отметка остаётся и при сетевой ошибке — сообщение, ушедшее по таймауту,
 * могло дойти, а дубль напоминания хуже потерянного.
 */
export async function claimNudge(
	db: Db,
	userId: string,
	kind: NudgeKind,
	now: Date
): Promise<boolean> {
	const stamp = now.toISOString();

	await db
		.insert(activationNudges)
		.values({ userId, createdAt: stamp, updatedAt: stamp })
		.onConflictDoNothing();

	const result = await db
		.update(activationNudges)
		.set(
			kind === 'first'
				? { firstSentAt: stamp, updatedAt: stamp }
				: { secondSentAt: stamp, updatedAt: stamp }
		)
		.where(
			and(
				eq(activationNudges.userId, userId),
				isNull(sentColumn(kind)),
				isNull(activationNudges.blockedAt)
			)
		);

	return result.rowsAffected > 0;
}

/** Снять отметку: Telegram ответил 429, сообщение точно не ушло. */
async function releaseNudge(db: Db, userId: string, kind: NudgeKind): Promise<void> {
	await db
		.update(activationNudges)
		.set(kind === 'first' ? { firstSentAt: null } : { secondSentAt: null })
		.where(eq(activationNudges.userId, userId));
}

/** 403 — бот заблокирован или аккаунт удалён в Telegram. Навсегда. */
export async function markBlocked(db: Db, userId: string, now: Date): Promise<void> {
	const stamp = now.toISOString();

	await db
		.insert(activationNudges)
		.values({ userId, blockedAt: stamp, createdAt: stamp, updatedAt: stamp })
		.onConflictDoUpdate({
			target: activationNudges.userId,
			set: { blockedAt: stamp, updatedAt: stamp }
		});
}

type NudgeSend = (chatId: string, text: string, options: SendMessageOptions) => Promise<void>;

export interface NudgeOptions {
	now?: Date;
	send?: NudgeSend;
	botToken?: string;
	miniAppUrl?: string;
	/** Пауза между отправками; в тестах — мгновенная. */
	sleep?: (ms: number) => Promise<void>;
}

export interface NudgeRunResult {
	sent: number;
	skipped: number;
	failed: number;
	blocked: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Проход по всем пользователям.
 *
 * Вызывается из того же планировщика, что и итоги дня, и сам решает,
 * кому сейчас пора: отдельного расписания заводить не нужно. Часто
 * вызывать безопасно — отметки в базе не дают отправить одно напоминание
 * дважды.
 */
export async function runActivationNudges(
	db: Db,
	users: UserRow[],
	options: NudgeOptions = {}
): Promise<NudgeRunResult> {
	const now = options.now ?? new Date();
	const sleep = options.sleep ?? wait;
	const botToken = options.botToken ?? env.TELEGRAM_BOT_TOKEN?.trim();
	const miniAppUrl = options.miniAppUrl ?? env.TELEGRAM_MINI_APP_URL?.trim();
	const states = await loadStates(db);

	const result: NudgeRunResult = { sent: 0, skipped: 0, failed: 0, blocked: 0 };
	let attempted = 0;

	for (const user of users) {
		let kind: NudgeKind | null = null;

		try {
			if (isDeletedUser(user)) {
				result.skipped += 1;
				continue;
			}

			kind = pickNudge({
				createdAt: user.createdAt,
				timezone: user.timezone,
				now,
				state: states.get(user.id) ?? null
			});

			// Запросы к базе — только тем, кому по времени что-то положено:
			// это единицы из всего списка.
			if (
				!kind ||
				(await hasAnyRecord(db, user.id)) ||
				!dailySummaryEnabled(await loadPlannerSettings(db, user.id)) ||
				!(await claimNudge(db, user.id, kind, now))
			) {
				result.skipped += 1;
				continue;
			}

			const text = kind === 'first' ? FIRST_NUDGE_TEXT : SECOND_NUDGE_TEXT;
			const replyMarkup = tryExamplesKeyboard(miniAppUrl);

			if (!botToken && !options.send) {
				// Локальная разработка: отправлять некуда, но видеть текст полезно.
				console.info(`[nudges] ${kind} для ${user.telegramUserId} (нет токена бота):\n${text}`);
				result.sent += 1;
				continue;
			}

			if (attempted > 0) await sleep(SEND_INTERVAL_MS);
			attempted += 1;

			await (options.send ?? sendMessage)(user.telegramUserId, text, { replyMarkup });
			result.sent += 1;
		} catch (error) {
			if (error instanceof BotApiError && error.status === 403) {
				// Заблокировал бота — это ответ, и повторять вопрос нельзя.
				await markBlocked(db, user.id, now).catch((markError) =>
					console.error(`[nudges] не отметил блокировку ${user.id}`, markError)
				);
				result.blocked += 1;
				continue;
			}

			result.failed += 1;

			if (error instanceof BotApiError && error.status === 429 && kind) {
				// Упёрлись в предел Telegram: это сообщение точно не ушло, и его
				// можно вернуть в очередь. Остальных догонит следующий проход —
				// продолжать сейчас значило бы собрать ещё десяток отказов.
				await releaseNudge(db, user.id, kind).catch(() => undefined);
				console.warn('[nudges] Telegram просит притормозить, проход остановлен');
				break;
			}

			console.error(`[nudges] пользователь ${user.id}`, error);
		}
	}

	return result;
}
