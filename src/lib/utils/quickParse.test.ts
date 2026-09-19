import { describe, expect, it } from 'vitest';
import { cleanTitle, extractDayOffset, extractTime, parseQuickEntry } from './quickParse';

describe('extractTime', () => {
	it('понимает все привычные записи часа', () => {
		// Человек пишет как удобно, а не как удобно программе.
		for (const text of ['ужин 19:00', 'ужин 19.00', 'ужин на 19 00', 'ужин в 19', 'ужин к 19']) {
			expect(extractTime(text)).toBe('19:00');
		}
	});

	it('понимает час с суффиксом', () => {
		expect(extractTime('созвон 9 часов')).toBe('09:00');
		expect(extractTime('созвон в 9ч')).toBe('09:00');
	});

	it('понимает части суток', () => {
		expect(extractTime('тренировка вечером')).toBe('19:00');
		expect(extractTime('пробежка утром')).toBe('09:00');
	});

	it('не выдумывает время там, где его нет', () => {
		expect(extractTime('позвонить врачу')).toBeUndefined();
	});

	it('не принимает несуществующее время', () => {
		expect(extractTime('дело в 25')).toBeUndefined();
		expect(extractTime('дело 19:70')).toBeUndefined();
	});
});

describe('extractDayOffset', () => {
	it('различает дни', () => {
		expect(extractDayOffset('завтра врач')).toBe(1);
		expect(extractDayOffset('послезавтра врач')).toBe(2);
		expect(extractDayOffset('вчера болел')).toBe(-1);
		expect(extractDayOffset('врач')).toBe(0);
	});
});

describe('cleanTitle', () => {
	it('убирает время и служебные слова', () => {
		expect(cleanTitle('завтра ужин в 19:00')).toBe('Ужин');
		expect(cleanTitle('ужин на 19 00')).toBe('Ужин');
	});

	it('оставляет осмысленное название целиком', () => {
		expect(cleanTitle('позвонить врачу')).toBe('Позвонить врачу');
	});

	it('никогда не возвращает пустую строку', () => {
		expect(cleanTitle('в 19:00').length).toBeGreaterThan(0);
		expect(cleanTitle('   ')).toBe('Дело');
	});
});

describe('parseQuickEntry', () => {
	it('разбирает фразу целиком', () => {
		expect(parseQuickEntry('завтра тренировка в 7')).toEqual({
			title: 'Тренировка',
			time: '07:00',
			dayOffset: 1
		});
	});
});
