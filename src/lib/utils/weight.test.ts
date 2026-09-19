import { describe, expect, it } from 'vitest';
import { isWeightInRange, parseWeightMessage, roundWeight, validateWeight } from './weight';

describe('isWeightInRange', () => {
	it('пропускает человеческий вес', () => {
		expect(isWeightInRange(78.4)).toBe(true);
		expect(isWeightInRange(20)).toBe(true);
		expect(isWeightInRange(400)).toBe(true);
	});

	it('отвергает промах по клавиатуре', () => {
		expect(isWeightInRange(7.8)).toBe(false);
		expect(isWeightInRange(780)).toBe(false);
		expect(isWeightInRange(Number.NaN)).toBe(false);
	});
});

describe('roundWeight', () => {
	it('убирает хвост от арифметики', () => {
		expect(roundWeight(78.30000000000001)).toBe(78.3);
	});
});

describe('validateWeight', () => {
	it('даёт понятный текст, а не просто отказ', () => {
		expect(validateWeight(780).weightKg).toContain('между');
	});
});

describe('parseWeightMessage', () => {
	it('разбирает обычные формы записи', () => {
		expect(parseWeightMessage('вес 78,4')).toBe(78.4);
		expect(parseWeightMessage('Вес 78.4')).toBe(78.4);
		expect(parseWeightMessage('вес: 78')).toBe(78);
		expect(parseWeightMessage('вес 78,4 кг')).toBe(78.4);
		expect(parseWeightMessage('  вес   78  ')).toBe(78);
	});

	it('не путает вес с калориями', () => {
		// «450 борщ» — это еда, и перепутать её с килограммами нельзя.
		expect(parseWeightMessage('450 борщ')).toBeNull();
		expect(parseWeightMessage('съел овсянку')).toBeNull();
	});

	it('нелепые значения не принимает', () => {
		expect(parseWeightMessage('вес 780')).toBeNull();
		expect(parseWeightMessage('вес 7')).toBeNull();
	});

	it('на постороннем тексте молчит', () => {
		expect(parseWeightMessage('вес растёт')).toBeNull();
		expect(parseWeightMessage('')).toBeNull();
	});
});
