import { describe, expect, it } from 'vitest';
import { extractAmount, parseIntentByRules, resolveDayOffset, resolveTime } from './intentRules';

/** Понедельник, 15:30 по Гринвичу — опора для «через час» и дней недели. */
const NOW = new Date('2026-01-12T15:30:00.000Z');
const options = { now: NOW, timeZone: 'UTC' };

const parse = (text: string) => parseIntentByRules(text, options);

describe('resolveTime', () => {
	it('понимает привычные написания часа', () => {
		expect(resolveTime('ужин в 19:00', options)).toBe('19:00');
		expect(resolveTime('ужин на 19.00', options)).toBe('19:00');
		expect(resolveTime('ужин в 19', options)).toBe('19:00');
		expect(resolveTime('созвон в 9:30', options)).toBe('09:30');
	});

	it('понимает часть суток словами', () => {
		// «в 7 вечера» — самая обычная речь, и без этого она давала 07:00.
		expect(resolveTime('ужин в 7 вечера', options)).toBe('19:00');
		expect(resolveTime('зарядка в 8 утра', options)).toBe('08:00');
		expect(resolveTime('встреча в 2 дня', options)).toBe('14:00');
	});

	it('не ломает полночь и полдень', () => {
		expect(resolveTime('в 12 ночи', options)).toBe('00:00');
		expect(resolveTime('в 12 дня', options)).toBe('12:00');
	});

	it('считает относительное время от момента разбора', () => {
		expect(resolveTime('через час позвонить', options)).toBe('16:30');
		expect(resolveTime('через 20 минут выйти', options)).toBe('15:50');
		expect(resolveTime('через полчаса', options)).toBe('16:00');
		expect(resolveTime('через 2 часа', options)).toBe('17:30');
	});

	it('считает «сейчас» временем разбора', () => {
		expect(resolveTime('съел сейчас банан', options)).toBe('15:30');
	});

	it('без времени ничего не выдумывает', () => {
		expect(resolveTime('позвонить маме', options)).toBeUndefined();
	});
});

describe('resolveDayOffset', () => {
	it('понимает слова про день', () => {
		expect(resolveDayOffset('завтра тренировка', options)).toBe(1);
		expect(resolveDayOffset('послезавтра врач', options)).toBe(2);
		expect(resolveDayOffset('вчера съел торт', options)).toBe(-1);
	});

	it('ближайший день недели, а не сегодняшний', () => {
		// Разбор идёт в понедельник: «в пятницу» — это через четыре дня,
		// а «в понедельник» — через неделю, иначе человек сказал бы «сегодня».
		expect(resolveDayOffset('в пятницу баня', options)).toBe(4);
		expect(resolveDayOffset('в понедельник отчёт', options)).toBe(7);
	});

	it('понимает «через N дней»', () => {
		expect(resolveDayOffset('через 3 дня', options)).toBe(3);
		expect(resolveDayOffset('через неделю', options)).toBe(7);
	});

	it('дальше недели не уходит', () => {
		expect(resolveDayOffset('через 30 дней', options)).toBe(7);
	});
});

describe('extractAmount', () => {
	it('понимает разговорные тысячи', () => {
		expect(extractAmount('потратил 1.5к на такси')).toBe(1500);
		expect(extractAmount('2к за обед')).toBe(2000);
	});

	it('понимает рубли и пробелы в разрядах', () => {
		expect(extractAmount('такси 500р')).toBe(500);
		expect(extractAmount('зарплата 90 000 ₽')).toBe(90000);
	});

	it('без числа молчит', () => {
		expect(extractAmount('купил хлеба')).toBeUndefined();
	});
});

describe('planы', () => {
	it('«ужин в 19:00» — дело на сегодня', () => {
		const intent = parse('ужин в 19:00');

		expect(intent.kind).toBe('plan');
		expect(intent.title).toBe('Ужин');
		expect(intent.time).toBe('19:00');
		expect(intent.dayOffset).toBe(0);
	});

	it('«завтра в 7 вечера ужин с Аней» — время, день и название', () => {
		const intent = parse('завтра в 7 вечера ужин с Аней');

		expect(intent.kind).toBe('plan');
		expect(intent.time).toBe('19:00');
		expect(intent.dayOffset).toBe(1);
		expect(intent.title).toContain('Ужин с Аней');
	});

	it('«через час позвонить врачу» — относительное время', () => {
		const intent = parse('через час позвонить врачу');

		expect(intent.kind).toBe('plan');
		expect(intent.time).toBe('16:30');
		expect(intent.title).toContain('врачу');
	});

	it('дело без времени тоже распознаётся, но с меньшей уверенностью', () => {
		const intent = parse('тренировка');

		expect(intent.kind).toBe('plan');
		expect(intent.confidence).toBeLessThan(0.8);
	});
});

describe('еда', () => {
	it('«450 борщ» — калории названы человеком', () => {
		const intent = parse('450 борщ');

		expect(intent.kind).toBe('food');
		expect(intent.calories).toBe(450);
		expect(intent.title).toBe('Борщ');
	});

	it('«съел овсянку 200 г» — граммы и глагол', () => {
		const intent = parse('съел овсянку 200 г');

		expect(intent.kind).toBe('food');
		expect(intent.grams).toBe(200);
	});

	it('«на обед борщ 450 ккал» — приём пищи из слова', () => {
		const intent = parse('на обед борщ 450 ккал');

		expect(intent.kind).toBe('food');
		expect(intent.calories).toBe(450);
		expect(intent.meal).toBe('lunch');
	});

	it('приём подставляется по времени, когда не назван', () => {
		const intent = parse('съел в 8 утра кашу 300 ккал');

		expect(intent.kind).toBe('food');
		expect(intent.meal).toBe('breakfast');
	});

	it('«съел в 14 суп» не уезжает в планы', () => {
		// Прошедшее время важнее упоминания часа.
		expect(parse('съел в 14 суп').kind).toBe('food');
	});
});

describe('деньги', () => {
	it('«потратил 500 на такси» — трата', () => {
		const intent = parse('потратил 500 на такси');

		expect(intent.kind).toBe('expense');
		expect(intent.amount).toBe(500);
		expect(intent.title).toBe('Такси');
	});

	it('«потратил 1.5к на продукты» — разговорные тысячи', () => {
		const intent = parse('потратил 1.5к на продукты');

		expect(intent.kind).toBe('expense');
		expect(intent.amount).toBe(1500);
	});

	it('«зарплата 90000» — доход', () => {
		const intent = parse('зарплата 90000');

		expect(intent.kind).toBe('income');
		expect(intent.amount).toBe(90000);
	});

	it('трата без суммы остаётся планом', () => {
		// Ноль в дневнике расходов бессмыслен, а «купить хлеба» — это дело.
		expect(parse('купить хлеба').kind).not.toBe('expense');
	});
});

describe('вес', () => {
	it('«вес 78,4» — взвешивание', () => {
		const intent = parse('вес 78,4');

		expect(intent.kind).toBe('weight');
		expect(intent.weightKg).toBe(78.4);
	});

	it('нелепое значение весом не считается', () => {
		expect(parse('вес 780').kind).not.toBe('weight');
	});

	it('«450 борщ» весом не становится', () => {
		expect(parse('450 борщ').kind).toBe('food');
	});
});

describe('чего разбирать не надо', () => {
	it('приветствия пропускаются', () => {
		expect(parse('привет').kind).toBe('unknown');
		expect(parse('спасибо').kind).toBe('unknown');
	});

	it('непонятая фраза честно помечается', () => {
		const intent = parse('ну такое себе');

		expect(intent.kind).toBe('unknown');
		expect(intent.confidence).toBeLessThan(0.5);
	});

	it('пустая строка ничего не создаёт', () => {
		expect(parse('   ').kind).toBe('unknown');
	});
});
