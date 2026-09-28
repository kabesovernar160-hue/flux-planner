import { describe, expect, it } from 'vitest';
import { cubicBezier, fluxEase } from './easing';

describe('cubicBezier', () => {
	it('линейная кривая возвращает вход', () => {
		const linear = cubicBezier(0, 0, 1, 1);
		for (const x of [0.1, 0.25, 0.5, 0.9]) expect(linear(x)).toBeCloseTo(x, 5);
	});

	it('закреплена на концах', () => {
		expect(fluxEase(0)).toBe(0);
		expect(fluxEase(1)).toBe(1);
		expect(fluxEase(-1)).toBe(0);
		expect(fluxEase(2)).toBe(1);
	});

	it('ease-flux быстро набирает ход и мягко садится', () => {
		// Кривая «выхода»: к середине времени пройдено больше половины пути.
		expect(fluxEase(0.5)).toBeGreaterThan(0.8);
		expect(fluxEase(0.1)).toBeGreaterThan(0.1);
	});

	it('монотонна', () => {
		let previous = 0;
		for (let step = 1; step <= 100; step++) {
			const value = fluxEase(step / 100);
			expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
			previous = value;
		}
	});
});
