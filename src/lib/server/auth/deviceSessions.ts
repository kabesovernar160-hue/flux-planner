import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { deviceSessions, users, type DeviceSessionRow, type UserRow } from '../db/schema';
import { createId } from '$lib/utils/id';

/**
 * Сессии устройств без Telegram.
 *
 * Mini App обходится без серверных сессий: подписанная строка запуска
 * приходит с каждым запросом. У приложения на главном экране телефона
 * такой строки нет, поэтому после входа по коду из бота устройство
 * получает свою сессию — куку «идентификатор.секрет».
 *
 * Правила:
 *
 * 1. **В базе только хеш секрета.** Копия базы не открывает сессий.
 * 2. **Кука httpOnly, SameSite=Lax.** Скрипт страницы её не видит,
 *    а межсайтовые POST-запросы уходят без неё.
 * 3. **Секрет меняется.** Раз в неделю при запуске приложения выдаётся новый;
 *    прежний принимается ещё несколько минут — запросы, ушедшие со старой
 *    кукой параллельно, не должны выкидывать человека.
 * 4. **Сессию можно отозвать.** Из списка устройств по одной или все сразу —
 *    и из приложения на телефоне, и из Mini App.
 * 5. **Срок скользящий.** 90 дней от последней ротации: пользуются —
 *    живёт, забросили телефон на три месяца — вход заново.
 */

export const DEVICE_COOKIE = 'fx_session';

export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const ROTATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const PREVIOUS_SECRET_GRACE_MS = 5 * 60 * 1000;

/** Отметка «был в сети» пишется не чаще раза в десять минут: это не журнал. */
const LAST_SEEN_STEP_MS = 10 * 60 * 1000;

const SECRET_BYTES = 32;

function hashSecret(secret: string): string {
	return createHash('sha256').update(secret).digest('hex');
}

function hashesMatch(left: string, right: string): boolean {
	const a = Buffer.from(left, 'hex');
	const b = Buffer.from(right, 'hex');
	return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function newSecret(): string {
	return randomBytes(SECRET_BYTES).toString('base64url');
}

function cookieValue(id: string, secret: string): string {
	return `${id}.${secret}`;
}

export function parseDeviceCookie(value: string): { id: string; secret: string } | null {
	const dot = value.indexOf('.');
	if (dot <= 0 || value.length > 300) return null;

	const id = value.slice(0, dot);
	const secret = value.slice(dot + 1);
	if (!/^[a-z0-9-]{8,64}$/.test(id) || !/^[A-Za-z0-9_-]{20,100}$/.test(secret)) return null;

	return { id, secret };
}

/**
 * Подпись устройства для списка: «iPhone · Safari».
 *
 * Только тип устройства и браузер — ровно столько, чтобы узнать свой телефон
 * в списке. Полный user-agent и адрес не хранятся: для отзыва они не нужны.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
	const ua = userAgent ?? '';

	const device = /iPhone/.test(ua)
		? 'iPhone'
		: /iPad/.test(ua)
			? 'iPad'
			: /Android/.test(ua)
				? 'Android'
				: /Macintosh|Mac OS X/.test(ua)
					? 'Mac'
					: /Windows/.test(ua)
						? 'Windows'
						: /Linux/.test(ua)
							? 'Linux'
							: null;

	const browser = /YaBrowser/.test(ua)
		? 'Яндекс Браузер'
		: /EdgA?\//.test(ua)
			? 'Edge'
			: /SamsungBrowser/.test(ua)
				? 'Samsung Internet'
				: /CriOS|Chrome\//.test(ua)
					? 'Chrome'
					: /FxiOS|Firefox\//.test(ua)
						? 'Firefox'
						: /Safari\//.test(ua)
							? 'Safari'
							: null;

	if (device && browser) return `${device} · ${browser}`;
	return device ?? browser ?? 'Браузер';
}

export interface IssuedDeviceSession {
	/** Значение куки. Уходит наружу один раз, в Set-Cookie. */
	cookie: string;
	session: DeviceSessionRow;
}

export async function createDeviceSession(
	db: Db,
	userId: string,
	options: { userAgent?: string | null; now?: Date } = {}
): Promise<IssuedDeviceSession> {
	const now = options.now ?? new Date();
	const timestamp = now.toISOString();
	const secret = newSecret();

	const row: DeviceSessionRow = {
		id: createId(),
		userId,
		secretHash: hashSecret(secret),
		previousSecretHash: null,
		label: deviceLabel(options.userAgent),
		createdAt: timestamp,
		rotatedAt: timestamp,
		lastSeenAt: timestamp,
		expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
		revokedAt: null
	};

	await db.insert(deviceSessions).values(row);

	return { cookie: cookieValue(row.id, secret), session: row };
}

export interface ValidDeviceSession {
	session: DeviceSessionRow;
	user: UserRow;
	/** Секрет старше недели — пора выдать новый (делает эндпоинт сессии). */
	needsRotation: boolean;
}

/**
 * Проверить куку устройства.
 *
 * null для отозванной, просроченной, чужой и просто испорченной куки —
 * вызывающему незачем знать, чем именно она плоха.
 */
export async function validateDeviceSession(
	db: Db,
	value: string,
	now: Date = new Date()
): Promise<ValidDeviceSession | null> {
	const parsed = parseDeviceCookie(value);
	if (!parsed) return null;

	const [row] = await db
		.select({ session: deviceSessions, user: users })
		.from(deviceSessions)
		.innerJoin(users, eq(users.id, deviceSessions.userId))
		.where(eq(deviceSessions.id, parsed.id))
		.limit(1);

	if (!row) return null;

	const { session, user } = row;
	const nowMs = now.getTime();

	if (session.revokedAt) return null;
	if (Date.parse(session.expiresAt) <= nowMs) return null;

	const hash = hashSecret(parsed.secret);
	const current = hashesMatch(session.secretHash, hash);
	const previous =
		!current &&
		session.previousSecretHash !== null &&
		hashesMatch(session.previousSecretHash, hash) &&
		Date.parse(session.rotatedAt) + PREVIOUS_SECRET_GRACE_MS > nowMs;

	if (!current && !previous) return null;

	if (nowMs - Date.parse(session.lastSeenAt) > LAST_SEEN_STEP_MS) {
		const lastSeenAt = now.toISOString();
		await db.update(deviceSessions).set({ lastSeenAt }).where(eq(deviceSessions.id, session.id));
		session.lastSeenAt = lastSeenAt;
	}

	return {
		session,
		user,
		// Со старым секретом новый уже выдан параллельным запросом.
		needsRotation: current && nowMs - Date.parse(session.rotatedAt) > ROTATE_AFTER_MS
	};
}

/**
 * Выдать новый секрет.
 *
 * UPDATE условный: из двух одновременных ротаций сработает одна, вторая
 * вернёт null, и её запрос останется со своей кукой — она ещё несколько
 * минут действительна как прежняя.
 */
export async function rotateDeviceSession(
	db: Db,
	session: Pick<DeviceSessionRow, 'id' | 'secretHash'>,
	now: Date = new Date()
): Promise<string | null> {
	const secret = newSecret();
	const timestamp = now.toISOString();

	const result = await db
		.update(deviceSessions)
		.set({
			secretHash: hashSecret(secret),
			previousSecretHash: session.secretHash,
			rotatedAt: timestamp,
			lastSeenAt: timestamp,
			expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
		})
		.where(
			and(
				eq(deviceSessions.id, session.id),
				eq(deviceSessions.secretHash, session.secretHash),
				isNull(deviceSessions.revokedAt)
			)
		);

	return (result.rowsAffected ?? 0) > 0 ? cookieValue(session.id, secret) : null;
}

export interface DeviceSessionSummary {
	id: string;
	label: string;
	createdAt: string;
	lastSeenAt: string;
}

/** Действующие сессии человека, свежие сверху. Хеши наружу не уходят. */
export async function listDeviceSessions(
	db: Db,
	userId: string,
	now: Date = new Date()
): Promise<DeviceSessionSummary[]> {
	return db
		.select({
			id: deviceSessions.id,
			label: deviceSessions.label,
			createdAt: deviceSessions.createdAt,
			lastSeenAt: deviceSessions.lastSeenAt
		})
		.from(deviceSessions)
		.where(
			and(
				eq(deviceSessions.userId, userId),
				isNull(deviceSessions.revokedAt),
				gt(deviceSessions.expiresAt, now.toISOString())
			)
		)
		.orderBy(desc(deviceSessions.lastSeenAt));
}

/** Отозвать одну сессию. Чужую не отзовёт: фильтр по владельцу обязателен. */
export async function revokeDeviceSession(db: Db, userId: string, id: string): Promise<boolean> {
	const result = await db
		.update(deviceSessions)
		.set({ revokedAt: new Date().toISOString() })
		.where(
			and(
				eq(deviceSessions.id, id),
				eq(deviceSessions.userId, userId),
				isNull(deviceSessions.revokedAt)
			)
		);

	return (result.rowsAffected ?? 0) > 0;
}

/** «Выйти везде»: все устройства человека разом. */
export async function revokeAllDeviceSessions(db: Db, userId: string): Promise<number> {
	const result = await db
		.update(deviceSessions)
		.set({ revokedAt: new Date().toISOString() })
		.where(and(eq(deviceSessions.userId, userId), isNull(deviceSessions.revokedAt)));

	return result.rowsAffected ?? 0;
}

/** Значение куки из заголовка Cookie — requireUser видит только Request. */
export function readCookie(header: string | null, name: string): string | null {
	if (!header) return null;

	for (const part of header.split(';')) {
		const eqIndex = part.indexOf('=');
		if (eqIndex < 0) continue;
		if (part.slice(0, eqIndex).trim() !== name) continue;

		const raw = part.slice(eqIndex + 1).trim();
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}

	return null;
}
