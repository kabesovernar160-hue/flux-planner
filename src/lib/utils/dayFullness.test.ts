import { describe, expect, it } from 'vitest';
import { dayFullness, foodPart, FULLNESS_LEVELS } from './dayFullness';

const empty = {
	calories: 0,
	spent: 0,
	habitsDone: 0,
	habitsPlanned: 0,
	planDone: 0,
	planTotal: 0
};

describe('foodPart', () => {
	it('без записей — ноль', () => {
		expect(foodPart(0, 2000)).toBe(0);
	});

	it('в коридоре цели — полный балл', () => {
		expect(foodPart(1600, 2000)).toBe(1);
		expect(foodPart(2200, 2000)).toBe(1);
	});

	it('мимо цели — половина: записи есть, но день не в цели', () => {
		expect(foodPart(900, 2000)).toBe(0.5);
		expect(foodPart(2500, 2000)).toBe(0.5);
	});

	it('без цели засчитывает сам факт записи', () => {
		expect(foodPart(500, 0)).toBe(1);
	});
});

describe('dayFullness', () => {
	it('пустой день — нулевая ступень', () => {
		const result = dayFullness(empty, 2000);
		expect(result.score).toBe(0);
		expect(result.level).toBe(0);
	});

	it('день, где всё закрыто, — верхняя ступень', () => {
		const result = dayFullness(
			{ calories: 2000, spent: 500, habitsDone: 3, habitsPlanned: 3, planDone: 2, planTotal: 2 },
			2000
		);
		expect(result.score).toBe(1);
		expect(result.level).toBe(FULLNESS_LEVELS);
	});

	it('день без трат не штрафуется', () => {
		const withoutMoney = dayFullness(
			{ ...empty, calories: 2000, habitsDone: 2, habitsPlanned: 2 },
			2000
		);
		expect(withoutMoney.parts.money).toBeNull();
		expect(withoutMoney.score).toBe(1);
	});

	it('незапланированные привычки и пустой план в среднее не входят', () => {
		const result = dayFullness({ ...empty, calories: 2000 }, 2000);
		expect(result.parts.habits).toBeNull();
		expect(result.parts.plan).toBeNull();
		expect(result.score).toBe(1);
	});

	it('усредняет разделы', () => {
		// Еда мимо цели (0.5) и половина привычек (0.5) — половина дня.
		const result = dayFullness({ ...empty, calories: 800, habitsDone: 1, habitsPlanned: 2 }, 2000);
		expect(result.score).toBe(0.5);
		expect(result.level).toBe(2);
	});

	it('любая запись даёт хотя бы первую ступень', () => {
		// Одна привычка из шести и никакой еды — почти пусто, но не ноль.
		const result = dayFullness({ ...empty, habitsDone: 1, habitsPlanned: 6 }, 2000);
		expect(result.score).toBeGreaterThan(0);
		expect(result.level).toBe(1);
	});

	it('не выходит за единицу при отметках сверх плана', () => {
		const result = dayFullness({ ...empty, calories: 2000, habitsDone: 4, habitsPlanned: 2 }, 2000);
		expect(result.parts.habits).toBe(1);
		expect(result.score).toBe(1);
	});
});
