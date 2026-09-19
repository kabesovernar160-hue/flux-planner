/** Ключ дня в формате YYYY-MM-DD. */
export type DateKey = string;

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is DateKey {
	return typeof value === 'string' && DATE_KEY_PATTERN.test(value);
}

/** Часовой пояс пользователя. Пустой или битый — откатываемся на UTC, не падаем. */
export function resolveTimeZone(timeZone?: string): string {
	if (timeZone) return timeZone;
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

/**
 * Календарная дата момента в часовом поясе пользователя.
 *
 * Локаль en-CA выбрана потому, что её формат даты — ровно YYYY-MM-DD,
 * что избавляет от ручной сборки строки и ошибок с ведущими нулями.
 */
export function formatDateKey(date: Date = new Date(), timeZone?: string): DateKey {
	try {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: resolveTimeZone(timeZone),
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(date);
	} catch {
		// Невалидный идентификатор пояса не должен ронять приложение.
		return date.toISOString().slice(0, 10);
	}
}

/**
 * Час суток в часовом поясе пользователя, 0…23.
 *
 * Считается через Intl, а не через getHours(): у сервера свой пояс, и «утро»
 * для человека в Иркутске не совпадает с утром процесса во Франкфурте.
 */
export function getHour(date: Date = new Date(), timeZone?: string): number {
	try {
		const formatted = new Intl.DateTimeFormat('en-GB', {
			timeZone: resolveTimeZone(timeZone),
			hour: '2-digit',
			hourCycle: 'h23'
		}).format(date);

		const hour = Number.parseInt(formatted, 10);
		return Number.isFinite(hour) ? hour : date.getUTCHours();
	} catch {
		// Невалидный пояс не должен ронять расчёт: UTC хуже, но работает.
		return date.getUTCHours();
	}
}

export function getToday(timeZone?: string): DateKey {
	return formatDateKey(new Date(), timeZone);
}

export function isToday(key: DateKey, timeZone?: string): boolean {
	return key === getToday(timeZone);
}

/**
 * Сдвиг ключа дня на N суток.
 *
 * Считается через Date.UTC, то есть по календарю, а не по абсолютному
 * времени. Локальная арифметика в поясе с переходом на летнее время даёт
 * сутки длиной 23 или 25 часов и перепрыгивает или повторяет день.
 */
export function addDays(key: DateKey, days: number): DateKey {
	const [y, m, d] = key.split('-').map(Number);
	const shifted = Date.UTC(y, m - 1, d) + days * 86_400_000;
	return new Date(shifted).toISOString().slice(0, 10);
}

/** Полночь указанного календарного дня в UTC. Для сравнения дней этого достаточно. */
export function startOfDay(input: DateKey | Date, timeZone?: string): Date {
	const key = typeof input === 'string' ? input : formatDateKey(input, timeZone);
	return new Date(`${key}T00:00:00.000Z`);
}

/** День недели ключа: 0 — воскресенье, 6 — суббота. */
export function dayOfWeek(key: DateKey): number {
	return startOfDay(key).getUTCDay();
}

/**
 * Сколько миллисекунд осталось до ближайшей полуночи по часам пользователя.
 *
 * В сутки перехода на летнее время результат может разойтись на час:
 * формула исходит из 24-часовых суток. Это допустимо, потому что
 * вызывающий код при срабатывании таймера заново сверяет ключ дня
 * и перевзводит таймер — расхождение выправляется на следующем тике.
 */
export function msUntilNextMidnight(now: Date = new Date(), timeZone?: string): number {
	let hours = 0;
	let minutes = 0;
	let seconds = 0;

	try {
		const parts = new Intl.DateTimeFormat('en-GB', {
			timeZone: resolveTimeZone(timeZone),
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		}).formatToParts(now);

		const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

		// en-GB отдаёт полночь как 24, а не 00.
		hours = part('hour') % 24;
		minutes = part('minute');
		seconds = part('second');
	} catch {
		const iso = now.toISOString();
		hours = Number(iso.slice(11, 13));
		minutes = Number(iso.slice(14, 16));
		seconds = Number(iso.slice(17, 19));
	}

	const elapsed = ((hours * 60 + minutes) * 60 + seconds) * 1000 + now.getMilliseconds();
	// Минимум секунда: нулевой таймаут крутил бы таймер вхолостую.
	return Math.max(1000, 86_400_000 - elapsed);
}

export function getNextMidnight(now: Date = new Date(), timeZone?: string): Date {
	return new Date(now.getTime() + msUntilNextMidnight(now, timeZone));
}

/** Единый формат отметок времени: UTC ISO 8601. */
export function nowIso(): string {
	return new Date().toISOString();
}
