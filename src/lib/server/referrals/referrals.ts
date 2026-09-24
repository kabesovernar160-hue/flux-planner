import { createHmac, randomInt } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
	REFERRAL_CAP_DAYS,
	REFERRAL_CODE_ALPHABET,
	REFERRAL_CODE_LENGTH,
	REFERRAL_REWARD_DAYS,
	parseReferralStartParam
} from '$lib/billing/referral';
import { createId } from '$lib/utils/id';
import { anonymousTelegramId } from '../account/deleteAccount';
import { grantProDays } from '../billing/subscriptions';
import type { Db, DbExecutor } from '../db/client';
import { financeEntries, foodEntries, habits, referralCodes, referrals, users } from '../db/schema';

/**
 * Реферальная программа на сервере.
 *
 * Все решения принимаются здесь, по данным из базы и из проверенной подписи
 * Telegram. Клиент только показывает ссылку и счётчик: всё, что приходит
 * от него, можно подделать, а дни Pro — это деньги.
 */

/**
 * Случайный код.
 *
 * randomInt, а не Math.random: код — это ключ к чужой награде, и
 * предсказуемый генератор позволил бы перебирать соседние коды.
 * 31 символ на 8 позиций — около 850 миллиардов вариантов.
 */
export function generateReferralCode(): string {
	let code = '';
	for (let index = 0; index < REFERRAL_CODE_LENGTH; index++) {
		code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
	}
	return code;
}

/**
 * Ключ приглашённого: HMAC от telegram id.
 *
 * Сам id после удаления аккаунта не хранится нигде — обещание политики
 * конфиденциальности. Но по ключу всё ещё видно, что этого человека уже
 * приглашали, и повторный вход по ссылке не принесёт дней ни ему, ни другу.
 * Секрет — токен бота: он есть на любом рабочем сервере, а без него перебор
 * десятизначных id по SHA-256 занял бы минуты.
 */
export function referralInviteeKey(telegramUserId: string, secret: string): string {
	return createHmac('sha256', secret).update(`referral:${telegramUserId}`).digest('hex');
}

/** Сколько раз пробовать новый код, если случайный уже занят. */
const CODE_ATTEMPTS = 5;

/**
 * Код пользователя, при необходимости — новый.
 *
 * Выдаётся лениво: при первом открытии экрана приглашения. Гонку двух
 * одновременных запросов решает уникальный индекс: вставка без конфликта
 * делает ничего, а код перечитывается из базы — у пользователя он один.
 */
export async function getOrCreateReferralCode(
	db: Db,
	userId: string,
	now: Date = new Date()
): Promise<string> {
	for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
		const [existing] = await db
			.select({ code: referralCodes.code })
			.from(referralCodes)
			.where(eq(referralCodes.userId, userId))
			.limit(1);

		if (existing) return existing.code;

		await db
			.insert(referralCodes)
			.values({ userId, code: generateReferralCode(), createdAt: now.toISOString() })
			.onConflictDoNothing();
	}

	throw new Error('Не удалось выдать реферальный код');
}

export type RegisterOutcome =
	/** Приглашение записано и ждёт первой записи. */
	| 'registered'
	/** Параметр запуска — не реферальный код. */
	| 'no_code'
	/** Человек уже был в базе до этого входа. */
	| 'not_new'
	/** Код никому не принадлежит. */
	| 'unknown_code'
	/** Своя же ссылка. */
	| 'self'
	/** Этого человека (или его Telegram) уже приглашали. */
	| 'already_referred';

export interface RegisterInput {
	inviteeId: string;
	/** Ключ от telegram id — см. referralInviteeKey. */
	inviteeKey: string;
	startParam: string | null | undefined;
	/**
	 * Пользователь заведён этим самым входом.
	 *
	 * Решает вызывающий код, потому что только он видит момент создания.
	 * Старого пользователя «пригласить» нельзя: иначе любой давний знакомый,
	 * открывший чужую ссылку, приносил бы дни, хотя пришёл не по ней.
	 */
	isNewUser: boolean;
	now?: Date;
}

/**
 * Запись приглашения при первом входе.
 *
 * Дни здесь ещё не начисляются: пустой аккаунт ничего не стоит, и накрутка
 * ими была бы бесплатной. Начисление — в qualifyReferral, после первой записи.
 */
export async function registerReferral(db: Db, input: RegisterInput): Promise<RegisterOutcome> {
	const code = parseReferralStartParam(input.startParam);
	if (!code) return 'no_code';
	if (!input.isNewUser) return 'not_new';

	const [owner] = await db
		.select({ userId: referralCodes.userId })
		.from(referralCodes)
		.where(eq(referralCodes.code, code))
		.limit(1);

	if (!owner) return 'unknown_code';
	if (owner.userId === input.inviteeId) return 'self';

	// Два уникальных индекса — по строке и по ключу Telegram — делают
	// повторное приглашение невозможным даже при гонке двух запросов.
	const result = await db
		.insert(referrals)
		.values({
			id: createId(),
			inviterId: owner.userId,
			inviteeId: input.inviteeId,
			inviteeKey: input.inviteeKey,
			status: 'pending',
			createdAt: (input.now ?? new Date()).toISOString()
		})
		.onConflictDoNothing();

	return result.rowsAffected > 0 ? 'registered' : 'already_referred';
}

/**
 * Есть ли у человека хоть одна живая запись: еда, привычка или трата.
 *
 * Вес, план дня и цели не в счёт: это одно нажатие без содержания,
 * и засчитывать приглашение за них — значит платить за пустой аккаунт.
 */
async function hasQualifyingRecord(db: DbExecutor, userId: string): Promise<boolean> {
	for (const table of [foodEntries, habits, financeEntries]) {
		const [row] = await db
			.select({ id: table.id })
			.from(table)
			.where(and(eq(table.userId, userId), isNull(table.deletedAt)))
			.limit(1);

		if (row) return true;
	}

	return false;
}

export interface QualifiedReferral {
	referralId: string;
	inviterId: string;
	inviteeId: string;
	/** Сколько дней получил пригласивший. Ноль — лимит уже выбран. */
	inviterDays: number;
	inviteeDays: number;
	/** Сколько всего дней пригласивший получил за приглашения, с этим. */
	inviterEarnedDays: number;
	inviteeExpiresAt: string;
	inviterExpiresAt: string | null;
}

/**
 * Засчитать приглашение, если пора.
 *
 * Вызывается после каждой записи с сервера — синхронизации, бота, быстрой
 * записи, — поэтому обязан быть дешёвым в частом случае «приглашения нет»:
 * это один запрос по уникальному индексу.
 *
 * Идемпотентно. Переход pending → qualified делается условным UPDATE, и
 * начисление идёт только за тем, кто этот переход совершил. Всё — в одной
 * транзакции: отметка без дней или дни без отметки хуже, чем ничего. libSQL
 * открывает её как BEGIN IMMEDIATE, поэтому два друга одного человека,
 * засчитанные одновременно, не перепрыгнут лимит, прочитав одну и ту же сумму.
 */
export async function qualifyReferral(
	db: Db,
	inviteeId: string,
	now: Date = new Date()
): Promise<QualifiedReferral | null> {
	const [pending] = await db
		.select({ id: referrals.id })
		.from(referrals)
		.where(and(eq(referrals.inviteeId, inviteeId), eq(referrals.status, 'pending')))
		.limit(1);

	if (!pending) return null;

	return withBusyRetry(() => claimReward(db, pending.id, inviteeId, now));
}

/** Паузы между попытками, если база занята другой записью. */
const BUSY_DELAYS_MS = [25, 75, 200];

/**
 * Повтор при занятой базе.
 *
 * Файловый SQLite не ждёт чужую транзакцию, а сразу отвечает SQLITE_BUSY.
 * Первая запись новичка часто приходит двумя путями одновременно —
 * синхронизацией и ботом, — и отказ одного из них не должен превращаться
 * в ошибку: достаточно дождаться, пока первый закончит, и увидеть, что
 * приглашение уже засчитано.
 */
async function withBusyRetry<T>(operation: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await operation();
		} catch (error) {
			const busy = (error as { code?: string } | null)?.code === 'SQLITE_BUSY';
			if (!busy || attempt >= BUSY_DELAYS_MS.length) throw error;
			await new Promise((resolve) => setTimeout(resolve, BUSY_DELAYS_MS[attempt]));
		}
	}
}

async function claimReward(
	db: Db,
	referralId: string,
	inviteeId: string,
	now: Date
): Promise<QualifiedReferral | null> {
	return db.transaction(async (tx) => {
		if (!(await hasQualifyingRecord(tx, inviteeId))) return null;

		const timestamp = now.toISOString();

		const claimed = await tx
			.update(referrals)
			.set({ status: 'qualified', qualifiedAt: timestamp, inviteeDays: REFERRAL_REWARD_DAYS })
			.where(and(eq(referrals.id, referralId), eq(referrals.status, 'pending')))
			.returning({ inviterId: referrals.inviterId });

		// Кто-то успел раньше — дни уже начислены им.
		if (claimed.length === 0) return null;

		const inviterId = claimed[0].inviterId;

		const [{ earned }] = await tx
			.select({ earned: sql<number>`COALESCE(SUM(${referrals.inviterDays}), 0)` })
			.from(referrals)
			.where(and(eq(referrals.inviterId, inviterId), eq(referrals.status, 'qualified')));

		const inviterDays = Math.max(
			0,
			Math.min(REFERRAL_REWARD_DAYS, REFERRAL_CAP_DAYS - Number(earned))
		);

		if (inviterDays > 0) {
			await tx.update(referrals).set({ inviterDays }).where(eq(referrals.id, referralId));
		}

		const inviteeExpiresAt = await grantProDays(tx, inviteeId, REFERRAL_REWARD_DAYS, now);
		const inviterExpiresAt =
			inviterDays > 0 ? await grantProDays(tx, inviterId, inviterDays, now) : null;

		return {
			referralId,
			inviterId,
			inviteeId,
			inviterDays,
			inviteeDays: REFERRAL_REWARD_DAYS,
			inviterEarnedDays: Number(earned) + inviterDays,
			inviteeExpiresAt,
			inviterExpiresAt
		};
	});
}

export interface ReferralSummary {
	code: string;
	/** Засчитанные друзья. */
	invited: number;
	/** Пришли по ссылке, но ещё ничего не записали. */
	pending: number;
	/** Сколько дней Pro получено за приглашения. */
	earnedDays: number;
}

export async function getReferralSummary(
	db: Db,
	userId: string,
	now: Date = new Date()
): Promise<ReferralSummary> {
	const code = await getOrCreateReferralCode(db, userId, now);

	const rows = await db
		.select({
			status: referrals.status,
			count: sql<number>`COUNT(*)`,
			days: sql<number>`COALESCE(SUM(${referrals.inviterDays}), 0)`
		})
		.from(referrals)
		.where(eq(referrals.inviterId, userId))
		.groupBy(referrals.status);

	const qualified = rows.find((row) => row.status === 'qualified');
	const pending = rows.find((row) => row.status === 'pending');

	return {
		code,
		invited: Number(qualified?.count ?? 0),
		pending: Number(pending?.count ?? 0),
		earnedDays: Number(qualified?.days ?? 0)
	};
}

/** Telegram id пригласившего — для сообщения в чат. */
export async function findTelegramId(db: Db, userId: string): Promise<string | null> {
	const [row] = await db
		.select({ telegramUserId: users.telegramUserId })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);

	// Обезличенному аккаунту писать некому.
	if (!row || row.telegramUserId === anonymousTelegramId(userId)) return null;
	return row.telegramUserId;
}
