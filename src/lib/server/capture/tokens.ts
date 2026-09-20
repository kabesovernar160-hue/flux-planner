import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { captureTokens, users, type UserRow } from '../db/schema';
import { createId } from '$lib/utils/id';
import { nowIso } from '$lib/utils/date';

/**
 * Ключи быстрой записи.
 *
 * Чтобы записать «ужин в 19:00», не открывая Telegram, запрос приходит
 * с телефона напрямую — из «Быстрой команды», с кнопки «Действие» или
 * по двойному касанию крышки. Подписи Telegram там нет и быть не может:
 * Mini App не запущен. Значит, нужен собственный ключ.
 *
 * Три правила, на которых он держится:
 *
 * 1. **В базе только хеш.** Утёкшая копия базы не должна открывать доступ
 *    к чужим дневникам, а сам ключ показывается человеку ровно один раз.
 * 2. **Ключ односторонний.** Им можно записать строку — и больше ничего:
 *    ни прочитать дневник, ни изменить настройки, ни купить подписку.
 *    Цена утечки — мусорная запись, а не потеря данных.
 * 3. **Активный ключ один.** Новый отзывает прежний. Список ключей,
 *    за которым никто не следит, — это ключ, о котором забыли.
 */

/** 32 байта: достаточно, чтобы перебор не имел смысла, и коротко для набора. */
const TOKEN_BYTES = 32;

export interface IssuedToken {
	/** Сам ключ. Показывается один раз и больше нигде не хранится. */
	token: string;
	createdAt: string;
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/**
 * Сравнение хешей, не зависящее от совпадающего начала.
 *
 * Обычное === на строках завершается на первом несовпавшем символе,
 * и по времени ответа хеш можно подобрать побайтно.
 */
function hashesMatch(left: string, right: string): boolean {
	const a = Buffer.from(left, 'hex');
	const b = Buffer.from(right, 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Выдача нового ключа.
 *
 * Прежние отзываются в той же транзакции: два действующих ключа означают,
 * что один из них человек не помнит, а отозвать может только оба.
 */
export async function issueCaptureToken(db: Db, userId: string): Promise<IssuedToken> {
	const token = randomBytes(TOKEN_BYTES).toString('base64url');
	const createdAt = nowIso();

	await db.transaction(async (tx) => {
		await tx
			.update(captureTokens)
			.set({ revokedAt: createdAt })
			.where(and(eq(captureTokens.userId, userId), isNull(captureTokens.revokedAt)));

		await tx.insert(captureTokens).values({
			id: createId(),
			userId,
			tokenHash: hashToken(token),
			createdAt,
			lastUsedAt: null,
			revokedAt: null
		});
	});

	return { token, createdAt };
}

export async function revokeCaptureTokens(db: Db, userId: string): Promise<number> {
	const result = await db
		.update(captureTokens)
		.set({ revokedAt: nowIso() })
		.where(and(eq(captureTokens.userId, userId), isNull(captureTokens.revokedAt)));

	return result.rowsAffected ?? 0;
}

export interface CaptureTokenState {
	exists: boolean;
	createdAt?: string;
	lastUsedAt?: string | null;
}

/** Состояние ключа для экрана настроек: сам ключ показать уже нельзя. */
export async function getCaptureTokenState(db: Db, userId: string): Promise<CaptureTokenState> {
	const [row] = await db
		.select()
		.from(captureTokens)
		.where(and(eq(captureTokens.userId, userId), isNull(captureTokens.revokedAt)))
		.limit(1);

	return row
		? { exists: true, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt }
		: { exists: false };
}

/**
 * Владелец ключа.
 *
 * Возвращает null для отозванного, несуществующего и просто мусорного
 * значения — вызывающему коду незачем знать, чем именно ключ плох:
 * разница в ответах помогает подбирать.
 */
export async function findUserByCaptureToken(db: Db, token: string): Promise<UserRow | null> {
	const trimmed = token.trim();
	if (trimmed.length < 20 || trimmed.length > 200) return null;

	const hash = hashToken(trimmed);

	const [row] = await db
		.select({ token: captureTokens, user: users })
		.from(captureTokens)
		.innerJoin(users, eq(users.id, captureTokens.userId))
		.where(and(eq(captureTokens.tokenHash, hash), isNull(captureTokens.revokedAt)))
		.limit(1);

	if (!row || !hashesMatch(row.token.tokenHash, hash)) return null;

	// Отметка использования нужна человеку, а не системе: по ней видно,
	// работает ли команда на телефоне вообще.
	await db
		.update(captureTokens)
		.set({ lastUsedAt: nowIso() })
		.where(eq(captureTokens.id, row.token.id));

	return row.user;
}
