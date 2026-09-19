import { describe, expect, it } from 'vitest';
import { normalizeIntent } from './intentSchema';
import { AiError } from './types';

const base = {
	kind: 'plan' as const,
	title: 'Ужин',
	time: '19:00',
	dayOffset: 0,
	amount: 0,
	grams: 0,
	calories: 0,
	note: '',
	confidence: 0.8
};

describe('normalizeIntent', () => {
	it('пропускает корректный разбор', () => {
		const result = normalizeIntent(base);

		expect(result).toMatchObject({ kind: 'plan', title: 'Ужин', time: '19:00', dayOffset: 0 });
	});

	it('отбрасывает мусорное время', () => {
		expect(normalizeIntent({ ...base, time: 'вечером' }).time).toBeUndefined();
		expect(normalizeIntent({ ...base, time: '25:00' }).time).toBeUndefined();
		expect(normalizeIntent({ ...base, time: '7:5' }).time).toBeUndefined();
	});

	it('ограничивает сдвиг дня неделей', () => {
		// «через триста дней» из короткой фразы означает ошибку разбора.
		expect(normalizeIntent({ ...base, dayOffset: 300 }).dayOffset).toBe(7);
		expect(normalizeIntent({ ...base, dayOffset: -300 }).dayOffset).toBe(-7);
	});

	it('трату без суммы считает планом, а не выдумывает число', () => {
		const result = normalizeIntent({ ...base, kind: 'expense', title: 'Такси', amount: 0 });

		expect(result.kind).toBe('plan');
		expect(result.amount).toBeUndefined();
	});

	it('сохраняет сумму у траты', () => {
		const result = normalizeIntent({ ...base, kind: 'expense', title: 'Такси', amount: 500 });

		expect(result.kind).toBe('expense');
		expect(result.amount).toBe(500);
	});

	it('пустое название превращает в «не понял»', () => {
		expect(normalizeIntent({ ...base, title: '   ' }).kind).toBe('unknown');
	});

	it('отвергает ответ не по схеме', () => {
		expect(() => normalizeIntent(null)).toThrow(AiError);
		expect(() => normalizeIntent({ ...base, kind: 'что-то' })).toThrow(AiError);
		expect(() => normalizeIntent({ ...base, dayOffset: 'завтра' })).toThrow(AiError);
	});

	it('обрезает абсурдные значения', () => {
		const result = normalizeIntent({
			...base,
			kind: 'food',
			grams: 999_999,
			calories: 999_999
		});

		expect(result.grams).toBe(20_000);
		expect(result.calories).toBe(20_000);
	});

	it('зажимает уверенность', () => {
		expect(normalizeIntent({ ...base, confidence: 5 }).confidence).toBe(1);
		expect(normalizeIntent({ ...base, confidence: -3 }).confidence).toBe(0);
	});
});
