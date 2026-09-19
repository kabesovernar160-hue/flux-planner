/**
 * Адаптер Telegram CloudStorage.
 *
 * Хранилище ограничено: до 1024 ключей и 4096 байт на значение, доступ только
 * из клиента Telegram. Поэтому сюда кладутся исключительно мелкие настройки —
 * тема, состояние онбординга, предпочтения уведомлений.
 *
 * История еды, привычек и трат сюда НЕ кладётся ни при каких условиях:
 * она не помещается по объёму, не переживает переустановку и не поддаётся
 * выборкам. Основные данные живут в базе, а локально — в IndexedDB.
 *
 * Модуль лежит в server/ вместе с остальным телеграм-кодом для единообразия,
 * но исполняется на клиенте: CloudStorage доступен только через window.Telegram.
 */

/** Предел значения в CloudStorage. */
export const MAX_VALUE_BYTES = 4096;

export const CLOUD_KEYS = {
	theme: 'theme',
	onboarding: 'onboarding',
	notifications: 'notifications',
	dashboardLayout: 'dashboard_layout'
} as const;

export type CloudKey = (typeof CLOUD_KEYS)[keyof typeof CLOUD_KEYS];

interface CloudStorageApi {
	getItem(key: string, callback: (error: string | null, value?: string) => void): void;
	setItem(
		key: string,
		value: string,
		callback?: (error: string | null, stored?: boolean) => void
	): void;
	removeItem(key: string, callback?: (error: string | null) => void): void;
}

function api(): CloudStorageApi | null {
	if (typeof window === 'undefined') return null;

	const webApp = (
		window as unknown as { Telegram?: { WebApp?: { CloudStorage?: CloudStorageApi } } }
	).Telegram?.WebApp;

	return webApp?.CloudStorage ?? null;
}

export function isCloudStorageAvailable(): boolean {
	return api() !== null;
}

/**
 * Чтение. Недоступность хранилища возвращает null, а не бросает: настройки
 * не критичны, и приложение должно работать без них.
 */
export function getCloudItem(key: CloudKey): Promise<string | null> {
	const storage = api();
	if (!storage) return Promise.resolve(null);

	return new Promise((resolve) => {
		try {
			storage.getItem(key, (error, value) => resolve(error ? null : (value ?? null)));
		} catch {
			resolve(null);
		}
	});
}

export function setCloudItem(key: CloudKey, value: string): Promise<boolean> {
	const storage = api();
	if (!storage) return Promise.resolve(false);

	// Превышение предела Telegram отклонит молча, поэтому проверяем сами:
	// иначе настройка тихо не сохранится и никто об этом не узнает.
	if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
		console.warn(`[cloudStorage] значение ключа ${key} больше ${MAX_VALUE_BYTES} байт`);
		return Promise.resolve(false);
	}

	return new Promise((resolve) => {
		try {
			storage.setItem(key, value, (error, stored) => resolve(!error && stored === true));
		} catch {
			resolve(false);
		}
	});
}

export function removeCloudItem(key: CloudKey): Promise<boolean> {
	const storage = api();
	if (!storage) return Promise.resolve(false);

	return new Promise((resolve) => {
		try {
			storage.removeItem(key, (error) => resolve(!error));
		} catch {
			resolve(false);
		}
	});
}

/** Объект настроек с проверкой размера и безопасным разбором. */
export async function getCloudJson<T>(key: CloudKey, fallback: T): Promise<T> {
	const raw = await getCloudItem(key);
	if (!raw) return fallback;

	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function setCloudJson(key: CloudKey, value: unknown): Promise<boolean> {
	return setCloudItem(key, JSON.stringify(value));
}
