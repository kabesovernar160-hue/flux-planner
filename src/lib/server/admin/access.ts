import { env } from '$env/dynamic/private';

/**
 * Кто видит статистику.
 *
 * Список telegram id в ADMIN_TELEGRAM_IDS через запятую. Умолчание —
 * владелец: статистика нужна с первого дня, и новая обязательная
 * переменная на проде стала бы ещё одним способом её не увидеть.
 * Пустое значение переменной равно её отсутствию — случайно выключить
 * доступ всем, оставив «ADMIN_TELEGRAM_IDS=» в .env, нельзя.
 */
export const DEFAULT_ADMIN_TELEGRAM_IDS = ['1145673466'];

export function parseAdminIds(raw: string | undefined): Set<string> {
	const ids = (raw ?? '')
		.split(/[\s,;]+/)
		.map((id) => id.trim())
		.filter((id) => /^\d+$/.test(id));

	return new Set(ids.length > 0 ? ids : DEFAULT_ADMIN_TELEGRAM_IDS);
}

/**
 * Проверка по id из проверенной подписи, а не по тому, что сообщил клиент.
 * Обезличенный аккаунт (deleted:…) под правило не попадает никогда.
 */
export function isAdminTelegramId(
	telegramUserId: string,
	raw: string | undefined = env.ADMIN_TELEGRAM_IDS
): boolean {
	return parseAdminIds(raw).has(telegramUserId);
}
