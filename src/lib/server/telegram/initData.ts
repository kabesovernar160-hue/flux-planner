import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramInitUser {
	id: number;
	firstName?: string;
	lastName?: string;
	username?: string;
	languageCode?: string;
	isPremium?: boolean;
}

export interface ValidatedInitData {
	user: TelegramInitUser;
	authDate: Date;
	queryId?: string;
	startParam?: string;
}

export type InitDataFailure =
	'EMPTY' | 'MALFORMED' | 'MISSING_HASH' | 'BAD_SIGNATURE' | 'EXPIRED' | 'MISSING_USER';

export type InitDataResult =
	{ ok: true; data: ValidatedInitData } | { ok: false; reason: InitDataFailure };

/**
 * Срок годности подписи.
 *
 * Без проверки давности перехваченная строка initData оставалась бы валидным
 * пропуском навсегда: подпись не устаревает сама по себе.
 */
export const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Сравнение, не зависящее от совпадающего префикса.
 *
 * Обычное === выходит на первом различающемся байте, и по времени ответа
 * хеш можно подобрать побайтово. timingSafeEqual требует одинаковой длины,
 * поэтому длина проверяется отдельно и до сравнения.
 */
function safeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	try {
		return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
	} catch {
		// Не-hex строка: Buffer.from молча обрежет её, и длины разойдутся.
		return false;
	}
}

function parseUser(raw: string | null): TelegramInitUser | null {
	if (!raw) return null;

	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return null;

		const user = parsed as Record<string, unknown>;
		if (typeof user.id !== 'number' || !Number.isFinite(user.id)) return null;

		return {
			id: user.id,
			firstName: typeof user.first_name === 'string' ? user.first_name : undefined,
			lastName: typeof user.last_name === 'string' ? user.last_name : undefined,
			username: typeof user.username === 'string' ? user.username : undefined,
			languageCode: typeof user.language_code === 'string' ? user.language_code : undefined,
			isPremium: user.is_premium === true
		};
	} catch {
		return null;
	}
}

/**
 * Проверка подписи initData по официальной схеме Telegram.
 *
 * Порядок важен: сначала из строки убирается hash, остальные поля
 * сортируются по имени и склеиваются переводами строк, затем ключом
 * становится HMAC от токена бота с константой WebAppData, и уже им
 * подписывается собранная строка.
 *
 * Идентификатору пользователя можно доверять ТОЛЬКО после этой проверки.
 * Присланный отдельно telegram_user_id ничего не значит: подделать его
 * может кто угодно.
 */
export function validateInitData(
	initData: string,
	botToken: string,
	options: { maxAgeSeconds?: number; now?: Date } = {}
): InitDataResult {
	if (!initData || !botToken) return { ok: false, reason: 'EMPTY' };

	let params: URLSearchParams;
	try {
		params = new URLSearchParams(initData);
	} catch {
		return { ok: false, reason: 'MALFORMED' };
	}

	const hash = params.get('hash');
	if (!hash) return { ok: false, reason: 'MISSING_HASH' };

	// Сама подпись в подписываемую строку не входит.
	params.delete('hash');

	const dataCheckString = [...params.entries()]
		.map(([key, value]) => `${key}=${value}`)
		.sort()
		.join('\n');

	const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
	const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

	if (!safeEqualHex(computed, hash)) return { ok: false, reason: 'BAD_SIGNATURE' };

	const authDateRaw = Number(params.get('auth_date'));
	if (!Number.isFinite(authDateRaw) || authDateRaw <= 0) {
		return { ok: false, reason: 'MALFORMED' };
	}

	const authDate = new Date(authDateRaw * 1000);
	const now = options.now ?? new Date();
	const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
	const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;

	// Будущая дата так же подозрительна, как просроченная: она означает
	// либо расхождение часов, либо подобранную строку.
	if (ageSeconds > maxAge || ageSeconds < -300) return { ok: false, reason: 'EXPIRED' };

	const user = parseUser(params.get('user'));
	if (!user) return { ok: false, reason: 'MISSING_USER' };

	return {
		ok: true,
		data: {
			user,
			authDate,
			queryId: params.get('query_id') ?? undefined,
			startParam: params.get('start_param') ?? undefined
		}
	};
}

/**
 * Сборка подписанной строки. Нужна тестам и локальной отладке —
 * в продакшене такую строку формирует клиент Telegram.
 */
export function signInitData(fields: Record<string, string>, botToken: string): string {
	const dataCheckString = Object.entries(fields)
		.map(([key, value]) => `${key}=${value}`)
		.sort()
		.join('\n');

	const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
	const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

	const params = new URLSearchParams(fields);
	params.set('hash', hash);
	return params.toString();
}
