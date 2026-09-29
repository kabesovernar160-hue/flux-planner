import { env } from '$env/dynamic/private';
import { createId } from '$lib/utils/id';
import { nowIso } from '$lib/utils/date';
import { getReadyDb } from '../db/client';
import { recordAppVisit } from '../activity/activity';
import { logServerError } from '../errors';
import { referralInviteeKey, registerReferral } from '../referrals/referrals';
import { createRepositories, type Repositories } from '../db/repositories';
import { validateInitData, type InitDataFailure } from '../telegram/initData';
import type { UserRow } from '../db/schema';
import { DEVICE_COOKIE, readCookie, validateDeviceSession } from './deviceSessions';

/** Заголовок, в котором Mini App присылает подписанную строку запуска. */
export const INIT_DATA_HEADER = 'x-telegram-init-data';

export class AuthError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'AuthError';
	}
}

/**
 * Чем удостоверен запрос.
 *
 * telegram — подписанная строка запуска Mini App, device — кука сессии
 * устройства (приложение на главном экране телефона, вход по коду из бота).
 */
export type SessionAuth =
	| { kind: 'telegram' }
	| { kind: 'device'; sessionId: string; secretHash: string; needsRotation: boolean };

export interface Session {
	user: UserRow;
	repositories: Repositories;
	auth: SessionAuth;
}

const FAILURE_MESSAGES: Record<InitDataFailure, string> = {
	EMPTY: 'Нет данных авторизации',
	MALFORMED: 'Некорректные данные авторизации',
	MISSING_HASH: 'Некорректные данные авторизации',
	BAD_SIGNATURE: 'Подпись не совпадает',
	EXPIRED: 'Сессия устарела, откройте приложение заново',
	MISSING_USER: 'В данных авторизации нет пользователя'
};

/**
 * Проверка запроса и получение пользователя. Единственная дверь для всех
 * эндпоинтов с данными человека.
 *
 * Два способа удостоверения, и порядок между ними важен:
 *
 * 1. Заголовок с initData — Mini App внутри Telegram. Если он есть, решает
 *    только он: неверная подпись — отказ, даже если рядом лежит кука.
 * 2. Кука сессии устройства — приложение на главном экране, вход по коду
 *    из бота. Проверяется по хешу в базе, отзывается из настроек.
 *
 * Идентификатор пользователя берётся ИСКЛЮЧИТЕЛЬНО из проверенной подписи
 * или сессии. Любое поле с telegram_user_id в теле запроса игнорируется:
 * подделать его может кто угодно.
 */
export async function requireUser(request: Request): Promise<Session> {
	const initData = request.headers.get(INIT_DATA_HEADER)?.trim() ?? '';
	if (initData) return requireTelegramUser(initData);

	const cookie = readCookie(request.headers.get('cookie'), DEVICE_COOKIE);
	if (cookie) return requireDeviceUser(request, cookie);

	throw new AuthError('UNAUTHENTICATED', FAILURE_MESSAGES.EMPTY, 401);
}

/**
 * Запрос с кукой устройства.
 *
 * Кука уходит с любым запросом к домену, поэтому изменяющие запросы
 * с чужого сайта отсекаются по Origin. SameSite=Lax и так не отдаёт куку
 * межсайтовому POST, но полагаться на один механизм браузера для двери
 * в чужой дневник не хочется.
 */
async function requireDeviceUser(request: Request, cookie: string): Promise<Session> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		const origin = request.headers.get('origin');
		if (origin && origin !== new URL(request.url).origin) {
			throw new AuthError('FORBIDDEN_ORIGIN', 'Запрос с чужого сайта', 403);
		}
	}

	const db = await getReadyDb();
	const valid = await validateDeviceSession(db, cookie);

	if (!valid) {
		throw new AuthError('UNAUTHENTICATED', 'Сессия закончилась, войдите заново', 401);
	}

	try {
		await recordAppVisit(db, valid.user, null);
	} catch (error) {
		// Статистика не должна стоить человеку входа.
		logServerError('activity/visit', error);
	}

	return {
		user: valid.user,
		repositories: createRepositories(db),
		auth: {
			kind: 'device',
			sessionId: valid.session.id,
			secretHash: valid.session.secretHash,
			needsRotation: valid.needsRotation
		}
	};
}

/**
 * Запрос из Mini App: подпись проверяется на каждом обращении, серверных
 * сессий нет. Для Mini App это проще и безопаснее куки: строка запуска
 * и так приходит с клиента при каждом старте, а отсутствие состояния
 * на сервере снимает вопросы протухания и инвалидации.
 */
async function requireTelegramUser(initData: string): Promise<Session> {
	const botToken = env.TELEGRAM_BOT_TOKEN?.trim();

	if (!botToken) {
		// Без токена проверить подпись физически невозможно. Пропускать всех
		// в таком состоянии нельзя: это открытая дверь в чужие данные.
		throw new AuthError('NOT_CONFIGURED', 'Авторизация не настроена', 500);
	}

	const result = validateInitData(initData, botToken);

	if (!result.ok) {
		throw new AuthError('UNAUTHENTICATED', FAILURE_MESSAGES[result.reason], 401);
	}

	const db = await getReadyDb();
	const repositories = createRepositories(db);
	const telegramUser = result.data.user;
	const now = nowIso();

	const user = await repositories.users.upsertFromTelegram({
		id: createId(),
		telegramUserId: String(telegramUser.id),
		username: telegramUser.username,
		firstName: telegramUser.firstName,
		now
	});

	// День присутствия и первое открытие — для воронки. Здесь, а не в
	// эндпоинте входа, по той же причине, что и приглашение ниже: первым
	// запросом может оказаться синхронизация.
	let firstOpen = false;
	try {
		({ firstOpen } = await recordAppVisit(db, user, result.data.startParam));
	} catch (error) {
		// Статистика не должна стоить человеку входа.
		logServerError('activity/visit', error);
	}

	// Приглашение записывается здесь, а не в эндпоинте входа: первым
	// запросом нового человека может оказаться и синхронизация — клиент
	// шлёт их параллельно, — и пропустить её значило бы потерять друга.
	// Пользователь новый, если строку завёл этот самый вызов (у давнего
	// createdAt остаётся прежним) или если это первое открытие приложения:
	// строку теперь заводит и /start в боте, а нажавший /start ещё ничем
	// не пользовался. Параметр запуска подписан вместе с initData,
	// поэтому подменить код в чужой ссылке нельзя.
	if (result.data.startParam && (user.createdAt === now || firstOpen)) {
		try {
			await registerReferral(db, {
				inviteeId: user.id,
				inviteeKey: referralInviteeKey(user.telegramUserId, botToken),
				startParam: result.data.startParam,
				isNewUser: true
			});
		} catch (error) {
			// Сбой приглашения не должен стоить человеку входа.
			logServerError('referrals/register', error);
		}
	}

	return { user, repositories, auth: { kind: 'telegram' } };
}
