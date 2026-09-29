import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, or, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { loginTokens, users, type UserRow } from '../db/schema';
import { createId } from '$lib/utils/id';

/**
 * Одноразовые коды входа без Telegram.
 *
 * Приложение на главном экране телефона открывается в браузере, и подписи
 * Telegram там нет. Удостоверить человека может только бот: он уже знает,
 * кто пишет. Поэтому бот выдаёт код, а приложение меняет его на сессию
 * устройства.
 *
 * Код короткий (10 символов из 32-буквенного алфавита, 50 бит), потому что
 * его иногда вводят руками: айфон не передаёт куку из Safari в приложение
 * на главном экране, и там код набирается в поле. Перебор закрывают три вещи
 * сразу: десять минут жизни, один обмен и предел попыток на адрес.
 *
 * В базе только хеш: утёкшая копия не открывает чужой дневник даже в эти
 * десять минут.
 */

/** Десять минут: дойти от чата до браузера хватает, забыть код в истории — нет. */
export const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Предел выдачи: пять кодов за десять минут на человека, общий для бота
 * и приложения. Больше не нужно никому, а спам кнопкой не засоряет базу.
 */
export const LOGIN_TOKEN_LIMIT = 5;
export const LOGIN_TOKEN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Алфавит Crockford base32: без I, L, O и U.
 *
 * Их легко спутать с 1 и 0 при наборе с экрана, а U убран, чтобы код
 * случайно не сложился в слово.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LOGIN_TOKEN_LENGTH = 10;

export interface IssuedLoginToken {
	/** Код для ссылки: 10 символов подряд. */
	token: string;
	/** Он же для глаз: «ABCDE-FGHJK». */
	code: string;
	expiresAt: string;
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
	// 256 делится на 32 без остатка: младшие пять бит байта распределены
	// равномерно, и перекоса в сторону части алфавита нет.
	const bytes = randomBytes(LOGIN_TOKEN_LENGTH);
	return Array.from(bytes, (byte) => ALPHABET[byte & 31]).join('');
}

/** «ABCDEFGHJK» → «ABCDE-FGHJK»: пять и пять читаются и набираются легче. */
export function formatLoginCode(token: string): string {
	return `${token.slice(0, 5)}-${token.slice(5)}`;
}

/**
 * Приведение введённого к каноническому виду.
 *
 * Пробелы, дефисы и регистр не важны, а O и I/L читаются как 0 и 1 —
 * именно их путают при наборе. Всё, что после этого не похоже на код,
 * отвергается до обращения к базе.
 */
export function normalizeLoginToken(raw: string): string | null {
	const cleaned = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

	if (cleaned.length !== LOGIN_TOKEN_LENGTH) return null;
	for (const char of cleaned) if (!ALPHABET.includes(char)) return null;

	return cleaned;
}

/**
 * Выдать код входа.
 *
 * Прежние неиспользованные коды этого человека стираются: живой код один,
 * и старое сообщение бота в чате перестаёт быть пропуском. Заодно
 * вычищаются давно протухшие строки — отдельного уборщика для них нет.
 */
export async function issueLoginToken(
	db: Db,
	userId: string,
	now: Date = new Date()
): Promise<IssuedLoginToken> {
	const token = generateToken();
	const createdAt = now.toISOString();
	const expiresAt = new Date(now.getTime() + LOGIN_TOKEN_TTL_MS).toISOString();
	const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

	await db.transaction(async (tx) => {
		await tx
			.delete(loginTokens)
			.where(
				or(
					and(eq(loginTokens.userId, userId), isNull(loginTokens.usedAt)),
					lt(loginTokens.expiresAt, dayAgo),
					and(isNotNull(loginTokens.usedAt), lt(loginTokens.usedAt, dayAgo))
				)
			);

		await tx.insert(loginTokens).values({
			id: createId(),
			userId,
			tokenHash: hashToken(token),
			createdAt,
			expiresAt,
			usedAt: null
		});
	});

	return { token, code: formatLoginCode(token), expiresAt };
}

/**
 * Обменять код на пользователя.
 *
 * Проверка и погашение — один условный UPDATE: два одновременных обмена
 * одного кода не могут оба увидеть его непогашенным, поэтому сессию
 * получит ровно один. Просроченный, погашенный и выдуманный коды
 * неразличимы для вызывающего: разница в ответах помогает подбирать.
 */
export async function consumeLoginToken(
	db: Db,
	raw: string,
	now: Date = new Date()
): Promise<UserRow | null> {
	const token = normalizeLoginToken(raw);
	if (!token) return null;

	const timestamp = now.toISOString();

	const [claimed] = await db
		.update(loginTokens)
		.set({ usedAt: timestamp })
		.where(
			and(
				eq(loginTokens.tokenHash, hashToken(token)),
				isNull(loginTokens.usedAt),
				gt(loginTokens.expiresAt, timestamp)
			)
		)
		.returning({ userId: loginTokens.userId });

	if (!claimed) return null;

	const [user] = await db.select().from(users).where(eq(users.id, claimed.userId)).limit(1);
	return user ?? null;
}

/**
 * Ссылка входа для кнопки в боте.
 *
 * Собирается от origin публичного адреса приложения: путь Mini App
 * (если он не корень) к странице входа отношения не имеет.
 */
export function loginUrl(appUrl: string, token: string): string {
	const url = new URL('/login', new URL(appUrl).origin);
	url.searchParams.set('token', token);
	return url.toString();
}
