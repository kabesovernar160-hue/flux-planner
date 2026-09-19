import { describe, expect, it } from 'vitest';
import { parseIntentLocally } from './mockIntent';

/**
 * Разбор без модели: работает, когда ключа нет или провайдер недоступен.
 * Он заметно грубее, но простые фразы обязан понимать.
 */
describe('parseIntentLocally', () => {
	it('понимает план со временем', () => {
		const result = parseIntentLocally('сегодня в 19:00 ужин');

		expect(result.kind).toBe('plan');
		expect(result.time).toBe('19:00');
		expect(result.dayOffset).toBe(0);
	});

	it('понимает час без минут', () => {
		expect(parseIntentLocally('в 7 тренировка').time).toBe('07:00');
	});

	it('различает завтра и вчера', () => {
		expect(parseIntentLocally('завтра в 9 врач').dayOffset).toBe(1);
		expect(parseIntentLocally('вчера съел пиццу').dayOffset).toBe(-1);
	});

	it('прошедшее время про еду — это еда, а не план', () => {
		expect(parseIntentLocally('съел овсянку').kind).toBe('food');
	});

	it('понимает трату с суммой', () => {
		const result = parseIntentLocally('потратил 500 на такси');

		expect(result.kind).toBe('expense');
		expect(result.amount).toBe(500);
	});

	it('понимает доход', () => {
		expect(parseIntentLocally('зарплата 90000').kind).toBe('income');
	});

	it('непонятное помечает как непонятое', () => {
		expect(parseIntentLocally('ну как дела').kind).toBe('unknown');
	});

	it('всегда оставляет непустое название', () => {
		expect(parseIntentLocally('в 19:00').title.length).toBeGreaterThan(0);
	});
});
