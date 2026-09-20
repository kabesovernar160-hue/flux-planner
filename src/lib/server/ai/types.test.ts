import { describe, expect, it } from 'vitest';
import { AiError, shouldRefundScan } from './types';

describe('shouldRefundScan', () => {
	it('возвращает попытку, когда ответа от модели не было', () => {
		// Ключ не настроен, провайдер лежит, снимок не прочитался, время вышло —
		// счёта за такой вызов нет, а человек остался ни с чем.
		for (const code of [
			'NOT_CONFIGURED',
			'PROVIDER_AUTH',
			'PROVIDER_ERROR',
			'TIMEOUT',
			'RATE_LIMITED',
			'INVALID_IMAGE',
			'IMAGE_TOO_LARGE',
			'INVALID_AI_RESPONSE'
		] as const) {
			expect(shouldRefundScan(new AiError(code, 'сообщение', 500))).toBe(true);
		}
	});

	it('не возвращает попытку за «это не еда»', () => {
		// Модель посмотрела и ответила — вызов оплачен. Иначе десяток снимков
		// кота подряд не стоит человеку ничего, а нам стоит по два цента,
		// и суточный предел перестаёт что-либо ограничивать.
		expect(shouldRefundScan(new AiError('NO_FOOD_DETECTED', 'Не еда', 422))).toBe(false);
	});

	it('своя поломка тоже возвращает попытку', () => {
		// Упало что-то неожиданное — это наша ошибка, а не его.
		expect(shouldRefundScan(new TypeError('undefined is not a function'))).toBe(true);
		expect(shouldRefundScan('строка')).toBe(true);
	});
});
