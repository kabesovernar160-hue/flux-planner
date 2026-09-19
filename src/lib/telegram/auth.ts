import { telegram } from './telegram.svelte.js';

/**
 * Заголовок, в котором Mini App передаёт подписанную строку запуска.
 * Совпадает с INIT_DATA_HEADER на сервере.
 */
export const INIT_DATA_HEADER = 'x-telegram-init-data';

/**
 * Заголовки авторизованного запроса.
 *
 * Передаётся ОРИГИНАЛЬНАЯ строка initData целиком: сервер проверяет её подпись
 * сам. Разобранные поля из initDataUnsafe отправлять бессмысленно и опасно —
 * подпись к ним не относится, и любой желающий пришлёт чужой идентификатор.
 */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
	const initData = telegram.initData;
	return initData ? { ...extra, [INIT_DATA_HEADER]: initData } : { ...extra };
}
