import type { Cookies } from '@sveltejs/kit';
import { isAdminTelegramId } from '../admin/access';
import { DEVICE_COOKIE, SESSION_TTL_MS } from './deviceSessions';
import type { Session } from './session';

/**
 * Ответ на вход — общий для Mini App и приложения на телефоне.
 *
 * Настройки отдаются прямо здесь, вместе с входом. Ждать первой
 * синхронизации нельзя: до неё приложение видит пустые настройки
 * и встречает знакомого человека приветствием для новичка.
 *
 * Наружу — только то, что клиент и так о себе знает. Внутренний
 * идентификатор тоже безопасен: он не даёт доступа без подписи или сессии.
 */
export async function authPayload({ user, repositories }: Pick<Session, 'user' | 'repositories'>) {
	const state = await repositories.planner.get(user.id);

	return {
		user: {
			id: user.id,
			telegramUserId: user.telegramUserId,
			firstName: user.firstName,
			username: user.username,
			timezone: user.timezone
		},
		state: state ? { settings: state.settings, settingsUpdatedAt: state.updatedAt } : null,
		// Только чтобы показать строку «Статистика» в настройках. Сама
		// статистика проверяет права заново: флаг из ответа ничего не открывает.
		...(isAdminTelegramId(user.telegramUserId) ? { admin: true } : {})
	};
}

/**
 * Кука сессии устройства.
 *
 * httpOnly — скрипт страницы её не видит; SameSite=Lax — межсайтовые POST
 * уходят без неё; Secure SvelteKit ставит сам везде, кроме http://localhost.
 * Срок совпадает со сроком сессии в базе, решает всё равно база.
 */
export function setDeviceCookie(cookies: Cookies, value: string): void {
	cookies.set(DEVICE_COOKIE, value, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: Math.floor(SESSION_TTL_MS / 1000)
	});
}

export function clearDeviceCookie(cookies: Cookies): void {
	cookies.delete(DEVICE_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' });
}
