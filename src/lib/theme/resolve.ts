import type { ThemePreference } from '$lib/types/planner';

export type { ThemePreference };
export type ColorScheme = 'light' | 'dark';

/**
 * Ключ, под которым выбор темы кешируется в localStorage.
 *
 * Источник правды — настройки (они синхронизируются), но до них надо
 * сначала поднять IndexedDB. Кеш читает скрипт в app.html ещё до первой
 * отрисовки, чтобы приложение не мигало чужой темой. Имя ключа продублировано
 * там — менять оба места вместе.
 */
export const THEME_STORAGE_KEY = 'fx-theme';

/**
 * Значение из настроек или кеша, приведённое к известному.
 *
 * Настройки приходят с сервера и из старых версий, поэтому доверять форме
 * нельзя: всё незнакомое означает «как в Telegram».
 */
export function normalizeThemePreference(value: unknown): ThemePreference {
	return value === 'light' || value === 'dark' ? value : 'auto';
}

/**
 * Какая тема будет на экране.
 *
 * @param environment тема окружения: Telegram внутри клиента,
 *   prefers-color-scheme в браузере.
 */
export function resolveTheme(preference: ThemePreference, environment: ColorScheme): ColorScheme {
	return preference === 'auto' ? environment : preference;
}
