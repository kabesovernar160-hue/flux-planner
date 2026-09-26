import { browser } from '$app/environment';
import { telegram } from '$lib/telegram';
import {
	normalizeThemePreference,
	resolveTheme,
	THEME_STORAGE_KEY,
	type ColorScheme,
	type ThemePreference
} from './resolve';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function readCachedPreference(): ThemePreference {
	if (!browser) return 'auto';
	try {
		return normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
	} catch {
		return 'auto';
	}
}

function writeCachedPreference(preference: ThemePreference): void {
	try {
		if (preference === 'auto') localStorage.removeItem(THEME_STORAGE_KEY);
		else localStorage.setItem(THEME_STORAGE_KEY, preference);
	} catch {
		/* хранилище недоступно — тема всё равно придёт из настроек */
	}
}

function systemScheme(): ColorScheme {
	if (!browser || typeof matchMedia !== 'function') return 'dark';
	return matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

/**
 * Тема на экране.
 *
 * Источников три: выбор в настройках, тема клиента Telegram и системная
 * prefers-color-scheme вне Telegram. Первую отрисовку делает скрипт
 * в app.html по кешу в localStorage — здесь состояние подхватывается
 * и дальше поддерживается в актуальном виде.
 */
class ThemeController {
	preference = $state<ThemePreference>(readCachedPreference());
	#system = $state<ColorScheme>(systemScheme());

	/** Тема окружения: клиента Telegram внутри него, системы — в браузере. */
	get environment(): ColorScheme {
		return telegram.isEmbedded ? telegram.colorScheme : this.#system;
	}

	get resolved(): ColorScheme {
		return resolveTheme(this.preference, this.environment);
	}

	/**
	 * Принять выбор из настроек.
	 *
	 * Кеш обновляется сразу: следующее открытие должно начаться в той же
	 * теме, ещё до того как поднимется база.
	 */
	setPreference(value: unknown): void {
		const next = normalizeThemePreference(value);
		writeCachedPreference(next);
		if (next !== this.preference) this.preference = next;
	}

	/**
	 * Следить за системной темой и применять итоговую к документу.
	 * Вызывать после telegram.init(): до него неизвестно, встроены ли мы.
	 */
	init(): () => void {
		if (!browser) return () => {};

		const media = typeof matchMedia === 'function' ? matchMedia(LIGHT_QUERY) : null;
		const onSystemChange = () => (this.#system = systemScheme());
		media?.addEventListener('change', onSystemChange);

		const stop = $effect.root(() => {
			$effect(() => applyTheme(this.resolved));
		});

		return () => {
			media?.removeEventListener('change', onSystemChange);
			stop();
		};
	}
}

/**
 * Перекрасить документ и хром Telegram.
 *
 * Атрибут и класс ставятся парой: токены живут на [data-theme], а вариант
 * dark: компонентов shadcn-svelte — на .dark.
 */
function applyTheme(scheme: ColorScheme): void {
	const root = document.documentElement;
	root.dataset.theme = scheme;
	root.classList.toggle('dark', scheme === 'dark');

	const chrome = getComputedStyle(root).getPropertyValue('--fx-chrome').trim();
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome);
	document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', scheme);

	if (chrome) telegram.setChromeColor(chrome);
}

export const theme = new ThemeController();
