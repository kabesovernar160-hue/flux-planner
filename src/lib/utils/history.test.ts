import { describe, expect, it } from 'vitest';
import { historyStart, isWithinHistory } from './history';

describe('historyStart', () => {
	it('сегодняшний день входит в счёт', () => {
		// 30 дней — это сегодня и 29 предыдущих, а не 31 день на экране.
		expect(historyStart(30, '2026-09-20')).toBe('2026-08-22');
		expect(historyStart(1, '2026-09-20')).toBe('2026-09-20');
	});

	it('переход через месяц и год считается по календарю', () => {
		expect(historyStart(7, '2026-03-03')).toBe('2026-02-25');
		expect(historyStart(7, '2026-01-03')).toBe('2025-12-28');
	});

	it('бессмысленная глубина сворачивается в сегодня', () => {
		expect(historyStart(0, '2026-09-20')).toBe('2026-09-20');
		expect(historyStart(-5, '2026-09-20')).toBe('2026-09-20');
		expect(historyStart(Number.NaN, '2026-09-20')).toBe('2026-09-20');
	});
});

describe('isWithinHistory', () => {
	const today = '2026-09-20';

	it('граничный день доступен, предыдущий — нет', () => {
		expect(isWithinHistory('2026-08-22', 30, today)).toBe(true);
		expect(isWithinHistory('2026-08-21', 30, today)).toBe(false);
	});

	it('будущее не ограничивается', () => {
		// План на завтра — не история, и прятать его не за что.
		expect(isWithinHistory('2026-12-31', 30, today)).toBe(true);
	});
});
