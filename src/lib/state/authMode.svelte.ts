import { telegram } from '$lib/telegram';

/**
 * Каким способом приложение удостоверяется на сервере.
 *
 * Внутри Telegram — подписью initData в заголовке. Вне его — кукой сессии
 * устройства после входа по коду из бота: кука httpOnly, скрипт её не видит,
 * поэтому о ней знает только эта отметка в localStorage.
 *
 * Отметка — подсказка, а не пропуск: решает сервер. Нужна она для двух
 * вещей: чтобы синхронизация стартовала сразу при запуске, не дожидаясь
 * ответа о сессии, и чтобы без сети человек, который уже входил, видел
 * свои данные, а не экран входа.
 *
 * Модуль отдельный и мелкий: его читают очередь синхронизации, тариф,
 * приглашения и сессия, и ни один из них не должен тянуть за собой другие.
 */

const DEVICE_HINT_KEY = 'fx-device-session';
const LOCAL_ONLY_KEY = 'fx-local-only';

function read(key: string): boolean {
	try {
		return globalThis.localStorage?.getItem(key) === '1';
	} catch {
		return false;
	}
}

function write(key: string, on: boolean): void {
	try {
		if (on) globalThis.localStorage?.setItem(key, '1');
		else globalThis.localStorage?.removeItem(key);
	} catch {
		/* хранилище недоступно — отметка проживёт до перезапуска */
	}
}

class AuthMode {
	/** На этом устройстве выполнен вход по коду из бота. */
	device = $state(read(DEVICE_HINT_KEY));

	/**
	 * Человек выбрал «Пользоваться без входа»: только локальные данные,
	 * экран входа больше не показывается сам.
	 */
	localOnly = $state(read(LOCAL_ONLY_KEY));

	setDevice(on: boolean): void {
		this.device = on;
		write(DEVICE_HINT_KEY, on);
		if (on) this.setLocalOnly(false);
	}

	setLocalOnly(on: boolean): void {
		this.localOnly = on;
		write(LOCAL_ONLY_KEY, on);
	}
}

export const authMode = new AuthMode();

/**
 * Есть ли чем удостовериться на сервере: подписью Telegram или сессией
 * устройства. Все обращения к API с личными данными проверяют это первым.
 */
export function canUseServer(): boolean {
	return (telegram.isEmbedded && Boolean(telegram.initData)) || authMode.device;
}
