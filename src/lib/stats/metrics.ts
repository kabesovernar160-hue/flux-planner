/**
 * Воронка активации и эффективность рекламы.
 *
 * Модуль намеренно без импортов: его же запускает scripts/stats.ts обычным
 * node, без сборки SvelteKit и без алиасов. Два расчёта — в приложении
 * и в терминале — разъехались бы при первой же правке определения «D1».
 *
 * Все дни — UTC. Это не часовой пояс человека, а общая линейка для всех:
 * когорта «пришли 12-го» должна означать одно и то же для Москвы и Алматы,
 * иначе сумма когорт не сойдётся с числом пользователей.
 *
 * Лежит вне $lib/server: экран /admin берёт отсюда типы ответа и подписи
 * источников. Секретов здесь нет — только определения и текст запросов.
 */

/* ───────────────────────── Источник ───────────────────────── */

export const SOURCE_DIRECT = 'direct';
export const SOURCE_REFERRAL = 'referral';
/** Пришёл до того, как источник начали записывать. */
export const SOURCE_UNKNOWN = 'unknown';
/** Метка есть, но на код не похожа: мусор или опечатка в ссылке. */
export const SOURCE_OTHER = 'other';

/**
 * Параметры запуска, которые приложение использует как навигацию
 * (t.me/бот/app?startapp=scan). Это кнопки самого бота, а не реклама:
 * записать «scan» в источники значило бы получить канал, которого нет.
 */
const APP_DEEP_LINKS = new Set(['scan', 'food', 'expense', 'income', 'habit', 'plan', 'week']);

const SOURCE_PATTERN = /^[a-z0-9_]{1,32}$/;

/**
 * Метка из /start <payload> или start_param Mini App — в источник.
 *
 * ref_* — приглашение, сам код в источник не идёт: он персональный,
 * и в разбивке по каналам тысяча строк по одному человеку ничего не скажет.
 * Короткий код (tiktok, reels, yt, tg…) сохраняется как есть — так новую
 * рекламу можно запустить, не трогая код. Дефис допустим в ссылках Telegram
 * и приводится к подчёркиванию, чтобы tiktok-1 и tiktok_1 не стали двумя
 * каналами.
 */
export function normalizeSource(payload: string | null | undefined): string {
	const value = (payload ?? '').trim().toLowerCase().replace(/-/g, '_');

	if (!value) return SOURCE_DIRECT;
	if (value.startsWith('ref_')) return SOURCE_REFERRAL;
	if (APP_DEEP_LINKS.has(value)) return SOURCE_DIRECT;
	if (SOURCE_PATTERN.test(value)) return value;
	return SOURCE_OTHER;
}

/** Параметр команды: «/start tiktok» → «tiktok». */
export function startPayload(text: string): string | null {
	const [, payload] = text.trim().split(/\s+/);
	return payload || null;
}

/* ───────────────────────── Тестовые аккаунты ───────────────────────── */

/**
 * Тестовый аккаунт: локальные пользователи разработки и выдуманные id.
 *
 * Настоящие id Telegram давно длиннее семи цифр, а короткие появляются
 * только в тестах и ручных проверках. Удалённые аккаунты (deleted:…) —
 * не тест: человек был, и воронка должна его помнить.
 */
export function isTestAccount(user: { username?: string | null; telegramUserId: string }): boolean {
	if ((user.username ?? '').toLowerCase().startsWith('local_test')) return true;
	return /^\d*$/.test(user.telegramUserId) && user.telegramUserId.length < 8;
}

/**
 * То же правило на SQL. Подчёркивание в LIKE — любой символ,
 * поэтому экранируется: иначе под правило попал бы и «localXtest».
 * coalesce обязателен: LIKE по NULL даёт NULL, NOT NULL — тоже NULL,
 * и человек без ника молча выпал бы из обеих половин статистики.
 */
export function testAccountSql(alias = 'u'): string {
	return (
		`(coalesce(${alias}.username, '') LIKE 'local!_test%' ESCAPE '!' OR ` +
		`(${alias}.telegram_user_id NOT GLOB '*[^0-9]*' AND length(${alias}.telegram_user_id) < 8))`
	);
}

/* ───────────────────────── Даты ───────────────────────── */

export function dayOf(iso: string): string {
	return iso.slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
	const date = new Date(`${day}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/* ───────────────────────── Расчёт ───────────────────────── */

export interface StatsUser {
	createdAt: string;
	source: string | null;
	appOpenedAt: string | null;
	firstRecordAt: string | null;
	/** Открывал приложение на следующий день после прихода. */
	returnedD1: boolean;
	/** Открывал приложение на седьмой день после прихода. */
	returnedD7: boolean;
}

/** Доля с явным знаменателем: «40 %» без «из скольких» ничего не значит. */
export interface Rate {
	count: number;
	of: number;
	/** Доля от 0 до 1, null — знаменатель пуст. */
	rate: number | null;
}

export interface Funnel {
	started: number;
	opened: Rate;
	activated: Rate;
	/**
	 * Возврат считается только по тем, у кого нужный день уже закончился:
	 * пришедшие сегодня ещё не могли вернуться завтра, и включать их
	 * в знаменатель значит занижать удержание каждый вечер.
	 */
	d1: Rate;
	d7: Rate;
}

export interface CohortDay {
	date: string;
	users: number;
	opened: number;
	activated: number;
	/** null — день возврата ещё не наступил. Сегодняшний счёт неполный. */
	d1: number | null;
	d7: number | null;
}

export interface SourceStats extends Funnel {
	source: string;
}

export interface ProStats {
	/** Pro действует прямо сейчас — оплаченный или подаренный. */
	active: number;
	/** Из них хоть раз платили звёздами. */
	paying: number;
}

export interface ReferralStats {
	/** Пришли по чужой ссылке. */
	invited: number;
	/** Сделали первую запись — приглашение засчитано. */
	qualified: number;
	pending: number;
	/** Сколько человек привели хотя бы одного. */
	inviters: number;
	/** Дней Pro роздано за приглашения обеим сторонам. */
	daysGranted: number;
}

export interface AdminStats {
	generatedAt: string;
	today: string;
	windowDays: number;
	/** Сколько строк не вошло как тестовые. */
	excludedTestAccounts: number;
	/** За всё время. */
	totals: Funnel & { newToday: number; newLast7: number };
	/** За окно: последние windowDays дней, включая сегодня. */
	funnel: Funnel;
	/** По дням окна, от старых к новым. */
	cohorts: CohortDay[];
	/** Разбивка окна по источникам, крупные первыми. */
	sources: SourceStats[];
	/** Та же разбивка за всё время. */
	sourcesAllTime: SourceStats[];
	pro: ProStats;
	referrals: ReferralStats;
}

export function rate(count: number, of: number): Rate {
	return { count, of, rate: of > 0 ? count / of : null };
}

/** Воронка по набору людей. today — сегодняшний день UTC. */
export function buildFunnel(users: StatsUser[], today: string): Funnel {
	let opened = 0;
	let activated = 0;
	let d1Eligible = 0;
	let d1 = 0;
	let d7Eligible = 0;
	let d7 = 0;

	for (const user of users) {
		const joined = dayOf(user.createdAt);
		if (user.appOpenedAt) opened++;
		if (user.firstRecordAt) activated++;

		// День возврата закончился — только тогда человек в знаменателе.
		if (shiftDay(joined, 1) < today) {
			d1Eligible++;
			if (user.returnedD1) d1++;
		}
		if (shiftDay(joined, 7) < today) {
			d7Eligible++;
			if (user.returnedD7) d7++;
		}
	}

	return {
		started: users.length,
		opened: rate(opened, users.length),
		activated: rate(activated, users.length),
		d1: rate(d1, d1Eligible),
		d7: rate(d7, d7Eligible)
	};
}

/** Когорты по дням прихода: windowDays строк, последняя — сегодня. */
export function buildCohorts(users: StatsUser[], today: string, windowDays: number): CohortDay[] {
	const days: CohortDay[] = [];
	const byDay = new Map<string, CohortDay>();

	for (let offset = windowDays - 1; offset >= 0; offset--) {
		const date = shiftDay(today, -offset);
		const day: CohortDay = {
			date,
			users: 0,
			opened: 0,
			activated: 0,
			d1: shiftDay(date, 1) <= today ? 0 : null,
			d7: shiftDay(date, 7) <= today ? 0 : null
		};
		days.push(day);
		byDay.set(date, day);
	}

	for (const user of users) {
		const day = byDay.get(dayOf(user.createdAt));
		if (!day) continue;

		day.users++;
		if (user.appOpenedAt) day.opened++;
		if (user.firstRecordAt) day.activated++;
		if (day.d1 !== null && user.returnedD1) day.d1++;
		if (day.d7 !== null && user.returnedD7) day.d7++;
	}

	return days;
}

export function buildSources(users: StatsUser[], today: string): SourceStats[] {
	const groups = new Map<string, StatsUser[]>();

	for (const user of users) {
		// Пусто — строка заведена после миграции, но без метки: /start без
		// параметра до входа в приложение или сообщение боту. Это и есть direct.
		const source = user.source ?? SOURCE_DIRECT;
		const group = groups.get(source);
		if (group) group.push(user);
		else groups.set(source, [user]);
	}

	return [...groups.entries()]
		.map(([source, group]) => ({ source, ...buildFunnel(group, today) }))
		.sort((a, b) => b.started - a.started || a.source.localeCompare(b.source));
}

export interface StatsInput {
	users: StatsUser[];
	excludedTestAccounts: number;
	pro: ProStats;
	referrals: ReferralStats;
	now: Date;
	windowDays?: number;
}

export function buildStats(input: StatsInput): AdminStats {
	const windowDays = input.windowDays ?? 30;
	const today = input.now.toISOString().slice(0, 10);
	const windowStart = shiftDay(today, -(windowDays - 1));
	const weekStart = shiftDay(today, -6);

	const recent = input.users.filter((user) => dayOf(user.createdAt) >= windowStart);

	return {
		generatedAt: input.now.toISOString(),
		today,
		windowDays,
		excludedTestAccounts: input.excludedTestAccounts,
		totals: {
			...buildFunnel(input.users, today),
			newToday: input.users.filter((user) => dayOf(user.createdAt) === today).length,
			newLast7: input.users.filter((user) => dayOf(user.createdAt) >= weekStart).length
		},
		funnel: buildFunnel(recent, today),
		cohorts: buildCohorts(input.users, today, windowDays),
		sources: buildSources(recent, today),
		sourcesAllTime: buildSources(input.users, today),
		pro: input.pro,
		referrals: input.referrals
	};
}

/* ───────────────────────── Чтение из базы ───────────────────────── */

/** Любой клиент SQLite: libSQL в приложении и в скрипте. */
export type QueryFn = (sql: string, args?: (string | number)[]) => Promise<Record<string, unknown>[]>;

const num = (value: unknown) => Number(value ?? 0) || 0;
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

/**
 * Все цифры одним заходом.
 *
 * Люди читаются целиком, а считаются в коде: даже десятки тысяч строк
 * по пять полей — это миллисекунды, а расчёт на TypeScript проверяется
 * тестами без базы. Возврат на D1/D7 — поиск по первичному ключу
 * user_activity для каждого, без просмотра всей таблицы присутствия.
 */
export async function collectStats(query: QueryFn, now: Date = new Date()): Promise<AdminStats> {
	const notTest = `NOT ${testAccountSql('u')}`;
	const joined = `substr(u.created_at, 1, 10)`;

	const userRows = await query(
		`SELECT u.created_at, u.source, u.app_opened_at, u.first_record_at,
		        EXISTS (SELECT 1 FROM user_activity a
		                WHERE a.user_id = u.id AND a.date = date(${joined}, '+1 day')) AS d1,
		        EXISTS (SELECT 1 FROM user_activity a
		                WHERE a.user_id = u.id AND a.date = date(${joined}, '+7 day')) AS d7
		 FROM users u
		 WHERE ${notTest}`
	);

	const [excluded] = await query(
		`SELECT count(*) AS n FROM users u WHERE ${testAccountSql('u')}`
	);

	// Pro — по тем же правилам, что resolveEntitlement: отменённая
	// и возвращённая подписки не в счёт, истёкшая тоже.
	const [pro] = await query(
		`SELECT count(*) AS active,
		        coalesce(sum(EXISTS (SELECT 1 FROM payments p
		                             WHERE p.user_id = s.user_id AND p.status = 'paid')), 0) AS paying
		 FROM subscriptions s
		 JOIN users u ON u.id = s.user_id
		 WHERE s.plan = 'pro'
		   AND s.status NOT IN ('refunded', 'cancelled')
		   AND s.expires_at > ?
		   AND ${notTest}`,
		[now.toISOString()]
	);

	const [referrals] = await query(
		`SELECT count(*) AS invited,
		        coalesce(sum(r.status = 'qualified'), 0) AS qualified,
		        coalesce(sum(r.status = 'pending'), 0) AS pending,
		        count(DISTINCT r.inviter_id) AS inviters,
		        coalesce(sum(r.invitee_days + r.inviter_days), 0) AS days
		 FROM referrals r
		 JOIN users u ON u.id = r.invitee_id
		 WHERE ${notTest}`
	);

	return buildStats({
		now,
		excludedTestAccounts: num(excluded?.n),
		users: userRows.map((row) => ({
			createdAt: String(row.created_at),
			source: str(row.source),
			appOpenedAt: str(row.app_opened_at),
			firstRecordAt: str(row.first_record_at),
			returnedD1: num(row.d1) > 0,
			returnedD7: num(row.d7) > 0
		})),
		pro: { active: num(pro?.active), paying: num(pro?.paying) },
		referrals: {
			invited: num(referrals?.invited),
			qualified: num(referrals?.qualified),
			pending: num(referrals?.pending),
			inviters: num(referrals?.inviters),
			daysGranted: num(referrals?.days)
		}
	});
}

/** Подпись источника для людей. */
export const SOURCE_LABELS: Record<string, string> = {
	[SOURCE_DIRECT]: 'Напрямую',
	[SOURCE_REFERRAL]: 'Приглашения',
	[SOURCE_UNKNOWN]: 'До учёта',
	[SOURCE_OTHER]: 'Другое',
	tiktok: 'TikTok',
	reels: 'Reels',
	yt: 'YouTube',
	tg: 'Telegram'
};

export function sourceLabel(source: string): string {
	return SOURCE_LABELS[source] ?? source;
}
