import { describe, expect, it } from 'vitest';
import { groupByMeal, mealForHour, mealForTime, resolveMeal } from './meals';

describe('mealForHour', () => {
	it('раскладывает день по обычному расписанию', () => {
		expect(mealForHour(8)).toBe('breakfast');
		expect(mealForHour(13)).toBe('lunch');
		expect(mealForHour(19)).toBe('dinner');
	});

	it('ночное считает перекусом, а не завтраком', () => {
		// Съеденное в два часа ночи — перекус. Записывать его в завтрак
		// значило бы испортить статистику завтраков ради формальной полноты.
		expect(mealForHour(2)).toBe('snack');
		expect(mealForHour(23)).toBe('snack');
	});

	it('границы окон не пересекаются', () => {
		expect(mealForHour(4)).toBe('breakfast');
		expect(mealForHour(10)).toBe('breakfast');
		expect(mealForHour(11)).toBe('lunch');
		expect(mealForHour(15)).toBe('lunch');
		expect(mealForHour(16)).toBe('dinner');
		expect(mealForHour(21)).toBe('dinner');
		expect(mealForHour(22)).toBe('snack');
	});
});

describe('mealForTime', () => {
	it('считает по часовому поясу пользователя, а не сервера', () => {
		// 06:00 UTC — это утро в Лондоне и уже обеденное время в Иркутске.
		const moment = new Date('2026-01-15T06:00:00.000Z');

		expect(mealForTime(moment, 'Europe/London')).toBe('breakfast');
		expect(mealForTime(moment, 'Asia/Irkutsk')).toBe('lunch');
	});

	it('на битом поясе не падает', () => {
		expect(mealForTime(new Date('2026-01-15T08:00:00.000Z'), 'Марс/Олимп')).toBe('breakfast');
	});
});

describe('resolveMeal', () => {
	it('уважает выбор человека', () => {
		expect(resolveMeal({ meal: 'dinner', createdAt: '2026-01-15T08:00:00.000Z' }, 'UTC')).toBe(
			'dinner'
		);
	});

	it('записи без приёма подбирает его по времени создания', () => {
		// У записей, сделанных до появления приёмов, поля нет. Показывать их
		// кучей «прочее» — мусор, а дописывать значение в базу — выдумка.
		expect(resolveMeal({ createdAt: '2026-01-15T08:30:00.000Z' }, 'UTC')).toBe('breakfast');
	});

	it('на испорченном времени не падает', () => {
		expect(resolveMeal({ createdAt: 'вчера' }, 'UTC')).toBe('snack');
		expect(resolveMeal({}, 'UTC')).toBe('snack');
	});
});

describe('groupByMeal', () => {
	const entry = (id: string, meal: string | undefined, calories: number) => ({
		id,
		meal: meal as never,
		createdAt: '2026-01-15T08:00:00.000Z',
		calories
	});

	it('держит порядок приёмов, а не порядок записей', () => {
		const groups = groupByMeal(
			[entry('1', 'dinner', 700), entry('2', 'breakfast', 300), entry('3', 'lunch', 500)],
			'UTC'
		);

		expect(groups.map((group) => group.meal)).toEqual(['breakfast', 'lunch', 'dinner']);
	});

	it('считает калории приёма', () => {
		const groups = groupByMeal([entry('1', 'lunch', 500), entry('2', 'lunch', 250)], 'UTC');

		expect(groups).toHaveLength(1);
		expect(groups[0].calories).toBe(750);
		expect(groups[0].entries).toHaveLength(2);
	});

	it('пустые приёмы не показывает', () => {
		// Четыре заголовка, три из которых пустые, занимают весь экран
		// и ничего не сообщают.
		const groups = groupByMeal([entry('1', 'snack', 120)], 'UTC');

		expect(groups.map((group) => group.label)).toEqual(['Перекус']);
	});

	it('пустой список даёт пустой результат', () => {
		expect(groupByMeal([], 'UTC')).toEqual([]);
	});
});
