import { describe, expect, it } from 'vitest';
import { normalizeThemePreference, resolveTheme } from './resolve';

describe('normalizeThemePreference', () => {
	it('пропускает известные значения', () => {
		expect(normalizeThemePreference('light')).toBe('light');
		expect(normalizeThemePreference('dark')).toBe('dark');
		expect(normalizeThemePreference('auto')).toBe('auto');
	});

	it('всё незнакомое читает как «как в Telegram»', () => {
		// Настройки старых версий поля не знают, а с сервера может прийти что угодно.
		expect(normalizeThemePreference(undefined)).toBe('auto');
		expect(normalizeThemePreference(null)).toBe('auto');
		expect(normalizeThemePreference('sepia')).toBe('auto');
		expect(normalizeThemePreference(1)).toBe('auto');
	});
});

describe('resolveTheme', () => {
	it('auto следует окружению', () => {
		expect(resolveTheme('auto', 'light')).toBe('light');
		expect(resolveTheme('auto', 'dark')).toBe('dark');
	});

	it('явный выбор сильнее окружения', () => {
		expect(resolveTheme('light', 'dark')).toBe('light');
		expect(resolveTheme('dark', 'light')).toBe('dark');
	});
});
