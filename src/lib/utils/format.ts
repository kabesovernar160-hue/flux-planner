/**
 * Форматирование чисел и дат для интерфейса.
 *
 * Intl.NumberFormat создаётся дорого, поэтому экземпляры кешируются по ключу:
 * на дашборде formatMoney вызывается для каждой категории при каждом
 * пересчёте производных значений.
 */

const moneyCache = new Map<string, Intl.NumberFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: number, currency = 'RUB', locale = 'ru-RU'): string {
	const key = `${locale}:${currency}`;
	let formatter = moneyCache.get(key);

	if (!formatter) {
		try {
			formatter = new Intl.NumberFormat(locale, {
				style: 'currency',
				currency,
				maximumFractionDigits: 0
			});
		} catch {
			// Неизвестный код валюты не должен ронять экран.
			formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
		}
		moneyCache.set(key, formatter);
	}

	return formatter.format(Number.isFinite(value) ? value : 0);
}

export function formatNumber(value: number, locale = 'ru-RU'): string {
	let formatter = numberCache.get(locale);

	if (!formatter) {
		try {
			formatter = new Intl.NumberFormat(locale);
		} catch {
			formatter = new Intl.NumberFormat('ru-RU');
		}
		numberCache.set(locale, formatter);
	}

	return formatter.format(Number.isFinite(value) ? value : 0);
}

/** Дробная часть только там, где она есть: «1,4 л», но «82 г». */
export function formatMacro(value: number): string {
	if (!Number.isFinite(value)) return '0';
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

/**
 * Вес: всегда с одним знаком после запятой.
 *
 * В отличие от макросов, «78» и «78,0» здесь не равнозначны: бытовые весы
 * показывают десятые, и ровное число выглядит как округление, которого
 * не делали. Одинаковая длина строки заодно не дёргает вёрстку при правке.
 */
export function formatWeight(value: number): string {
	if (!Number.isFinite(value)) return '0,0';
	return value.toFixed(1).replace('.', ',');
}

/** Приветствие по местному времени устройства. */
export function greeting(date = new Date()): string {
	const h = date.getHours();
	if (h < 5) return 'Доброй ночи';
	if (h < 12) return 'Доброе утро';
	if (h < 18) return 'Добрый день';
	return 'Добрый вечер';
}

/** Склонение счётчика дней: 1 день, 2 дня, 5 дней. */
export function pluralDays(n: number): string {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return 'день';
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
	return 'дней';
}
