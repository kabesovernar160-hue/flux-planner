import { describe, expect, it } from 'vitest';
import { calculateBmr, calculateGoals, validateProfile, type ProfileInput } from './goals';

const base: ProfileInput = {
	sex: 'male',
	age: 30,
	heightCm: 180,
	weightKg: 80,
	activity: 'medium',
	goal: 'maintain'
};

describe('calculateBmr', () => {
	it('считает по Миффлину–Сан Жеору для мужчины', () => {
		// 10*80 + 6.25*180 - 5*30 + 5 = 1780
		expect(calculateBmr(base)).toBe(1780);
	});

	it('считает для женщины', () => {
		// 10*65 + 6.25*165 - 5*30 - 161 = 1370.25 → 1370
		expect(calculateBmr({ ...base, sex: 'female', weightKg: 65, heightCm: 165 })).toBe(1370);
	});

	it('с возрастом расход падает', () => {
		expect(calculateBmr({ ...base, age: 60 })).toBeLessThan(calculateBmr({ ...base, age: 25 }));
	});
});

describe('calculateGoals', () => {
	it('учитывает активность', () => {
		const sedentary = calculateGoals({ ...base, activity: 'low' });
		const athlete = calculateGoals({ ...base, activity: 'athlete' });

		expect(athlete.calorieGoal).toBeGreaterThan(sedentary.calorieGoal);
		expect(sedentary.tdee).toBe(Math.round(sedentary.bmr * 1.2));
	});

	it('делает дефицит при цели снизить вес и профицит при наборе', () => {
		const maintain = calculateGoals(base).calorieGoal;

		expect(calculateGoals({ ...base, goal: 'lose' }).calorieGoal).toBeLessThan(maintain);
		expect(calculateGoals({ ...base, goal: 'gain' }).calorieGoal).toBeGreaterThan(maintain);
	});

	it('не опускает калории ниже безопасного минимума', () => {
		// Худенькая пожилая женщина с сидячим образом жизни и дефицитом:
		// формула сама по себе ушла бы опасно низко.
		const result = calculateGoals({
			sex: 'female',
			age: 70,
			heightCm: 150,
			weightKg: 45,
			activity: 'low',
			goal: 'lose'
		});

		expect(result.calorieGoal).toBeGreaterThanOrEqual(1200);
	});

	it('поднимает белок при похудении', () => {
		const lose = calculateGoals({ ...base, goal: 'lose' });
		const maintain = calculateGoals(base);

		expect(lose.proteinGoal).toBeGreaterThan(maintain.proteinGoal);
	});

	it('держит макросы в пределах калорийности', () => {
		const result = calculateGoals(base);
		const fromMacros = result.proteinGoal * 4 + result.fatGoal * 9 + result.carbsGoal * 4;

		// Расхождение только за счёт округления до грамма.
		expect(Math.abs(fromMacros - result.calorieGoal)).toBeLessThanOrEqual(10);
	});

	it('не уводит углеводы в минус', () => {
		const result = calculateGoals({
			sex: 'male',
			age: 25,
			heightCm: 165,
			weightKg: 140,
			activity: 'low',
			goal: 'lose'
		});

		expect(result.carbsGoal).toBeGreaterThanOrEqual(0);
	});

	it('считает воду от веса', () => {
		expect(calculateGoals(base).waterGoalMl).toBe(2400);
	});
});

describe('validateProfile', () => {
	it('пропускает корректную анкету', () => {
		expect(validateProfile(base)).toEqual({});
	});

	it('ловит невозможные значения', () => {
		expect(validateProfile({ ...base, age: 5 }).age).toBeDefined();
		expect(validateProfile({ ...base, heightCm: 40 }).heightCm).toBeDefined();
		expect(validateProfile({ ...base, weightKg: 500 }).weightKg).toBeDefined();
	});

	it('ловит пропущенные поля', () => {
		const errors = validateProfile({});

		expect(errors.sex).toBeDefined();
		expect(errors.activity).toBeDefined();
		expect(errors.goal).toBeDefined();
	});

	it('ловит нечисловой ввод', () => {
		expect(validateProfile({ ...base, weightKg: Number.NaN }).weightKg).toBeDefined();
	});
});
