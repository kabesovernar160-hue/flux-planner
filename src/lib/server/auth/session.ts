import { env } from '$env/dynamic/private';
import { createId } from '$lib/utils/id';
import { nowIso } from '$lib/utils/date';
import { getReadyDb } from '../db/client';
import { logServerError } from '../errors';
import { referralInviteeKey, registerReferral } from '../referrals/referrals';
import { createRepositories, type Repositories } from '../db/repositories';
import { validateInitData, type InitDataFailure } from '../telegram/initData';
import type { UserRow } from '../db/schema';

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

export interface Session {
	user: UserRow;
	repositories: Repositories;
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
 * Проверка запроса и получение пользователя.
 *
 * Подпись проверяется на каждом обращении, серверных сессий нет. Для Mini App
 * это проще и безопаснее куки: строка запуска и так приходит с клиента при
 * каждом старте, а отсутствие состояния на сервере снимает вопросы протухания
 * и инвалидации.
 *
 * Идентификатор пользователя берётся ИСКЛЮЧИТЕЛЬНО из проверенной подписи.
 * Любое поле с telegram_user_id в теле запроса игнорируется: подделать его
 * может кто угодно.
 */
export async function requireUser(request: Request): Promise<Session> {
	const botToken = env.TELEGRAM_BOT_TOKEN?.trim();

	if (!botToken) {
		// Без токена проверить подпись физически невозможно. Пропускать всех
		// в таком состоянии нельзя: это открытая дверь в чужие данные.
		throw new AuthError('NOT_CONFIGURED', 'Авторизация не настроена', 500);
	}

	const initData = request.headers.get(INIT_DATA_HEADER) ?? '';
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

	// Приглашение записывается здесь, а не в эндпоинте входа: первым
	// запросом нового человека может оказаться и синхронизация — клиент
	// шлёт их параллельно, — и пропустить её значило бы потерять друга.
	// Пользователь новый, если строку завёл этот самый вызов: у давнего
	// createdAt остаётся прежним. Параметр запуска подписан вместе с
	// initData, поэтому подменить код в чужой ссылке нельзя.
	if (result.data.startParam && user.createdAt === now) {
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

	return { user, repositories };
}
