import { describe, expect, it } from 'vitest';
import {
	addDays,
	dayOfWeek,
	formatDateKey,
	getToday,
	isDateKey,
	isToday,
	msUntilNextMidnight,
	nowIso,
	resolveTimeZone,
	startOfDay
} from './date';

describe('formatDateKey', () => {
	const instant = new Date('2026-01-15T22:30:00.000Z');

	it('отдаёт YYYY-MM-DD', () => {
		expect(formatDateKey(instant, 'UTC')).toBe('2026-01-15');
	});

	it('учитывает часовой пояс: в Токио это уже следующий день', () => {
		expect(formatDateKey(instant, 'Asia/Tokyo')).toBe('2026-01-16');
	});

	it('учитывает часовой пояс: в Лос-Анджелесе ещё тот же день', () => {
		expect(formatDateKey(instant, 'America/Los_Angeles')).toBe('2026-01-15');
	});

	it('не падает на неизвестном поясе', () => {
		expect(() => formatDateKey(instant, 'Не/Существует')).not.toThrow();
		expect(isDateKey(formatDateKey(instant, 'Не/Существует'))).toBe(true);
	});
});

describe('addDays', () => {
	it('переходит через границу месяца', () => {
		expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
	});

	it('переходит через границу года', () => {
		expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
	});

	it('знает про високосный год', () => {
		expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
		expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
	});

	it('не сбивается в сутки перехода на летнее время', () => {
		// 29 марта 2026 — перевод часов в Европе. Арифметика идёт по календарю,
		// поэтому сутки не превращаются в 23 или 25 часов.
		expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
		expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
	});

	it('идёт назад', () => {
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addDays('2026-01-01', -7)).toBe('2025-12-25');
	});

	it('нулевой сдвиг возвращает тот же ключ', () => {
		expect(addDays('2026-06-15', 0)).toBe('2026-06-15');
	});
});

describe('dayOfWeek', () => {
	it('1 января 2026 — четверг', () => {
		expect(dayOfWeek('2026-01-01')).toBe(4);
	});

	it('воскресенье это 0', () => {
		expect(dayOfWeek('2026-01-04')).toBe(0);
	});
});

describe('isToday и getToday', () => {
	it('сегодняшний ключ считается сегодняшним', () => {
		expect(isToday(getToday())).toBe(true);
	});

	it('вчерашний — нет', () => {
		expect(isToday(addDays(getToday(), -1))).toBe(false);
	});
});

describe('startOfDay', () => {
	it('даёт полночь UTC для ключа', () => {
		expect(startOfDay('2026-01-15').toISOString()).toBe('2026-01-15T00:00:00.000Z');
	});
});

describe('msUntilNextMidnight', () => {
	it('за час до полуночи возвращает час', () => {
		const at2300 = new Date('2026-01-15T23:00:00.000Z');
		expect(msUntilNextMidnight(at2300, 'UTC')).toBe(3_600_000);
	});

	it('сразу после полуночи возвращает почти полные сутки', () => {
		const at0001 = new Date('2026-01-15T00:01:00.000Z');
		expect(msUntilNextMidnight(at0001, 'UTC')).toBe(86_400_000 - 60_000);
	});

	it('никогда не отдаёт ноль или отрицательное', () => {
		const atMidnight = new Date('2026-01-15T00:00:00.000Z');
		expect(msUntilNextMidnight(atMidnight, 'UTC')).toBeGreaterThan(0);
	});

	it('учитывает пояс', () => {
		const instant = new Date('2026-01-15T23:00:00.000Z');
		// В Токио это 08:00 следующего дня, до полуночи ещё 16 часов.
		expect(msUntilNextMidnight(instant, 'Asia/Tokyo')).toBe(16 * 3_600_000);
	});
});

describe('resolveTimeZone', () => {
	it('возвращает переданный пояс', () => {
		expect(resolveTimeZone('Europe/Moscow')).toBe('Europe/Moscow');
	});

	it('без аргумента отдаёт непустую строку', () => {
		expect(resolveTimeZone().length).toBeGreaterThan(0);
	});
});

describe('nowIso', () => {
	it('отдаёт UTC ISO 8601', () => {
		expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	});
});
