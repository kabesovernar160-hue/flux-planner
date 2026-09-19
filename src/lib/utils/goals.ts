/**
 * Расчёт дневных целей по анкете.
 *
 * Значения по умолчанию (2100 ккал, 120 г белка) — это средняя температура
 * по больнице: мужчине 95 кг они малы, миниатюрной женщине велики, и дневник
 * с такими целями показывает не результат, а случайную цифру. Анкета из пяти
 * вопросов даёт числа, к которым есть доверие.
 *
 * Формула — Миффлина–Сан Жеора: она точнее Харриса–Бенедикта на современных
 * выборках и не требует данных о составе тела, которых у нас нет.
 * Это всё равно ОЦЕНКА: реальный расход отличается на ±10 %, и интерфейс
 * не должен изображать точность, которой нет.
 */

export type Sex = 'male' | 'female';
export type ActivityLevel = 'low' | 'light' | 'medium' | 'high' | 'athlete';
export type WeightGoal = 'lose' | 'maintain' | 'gain';

export interface ProfileInput {
	sex: Sex;
	age: number;
	heightCm: number;
	weightKg: number;
	activity: ActivityLevel;
	goal: WeightGoal;
}

export interface GoalSuggestion {
	calorieGoal: number;
	proteinGoal: number;
	fatGoal: number;
	carbsGoal: number;
	waterGoalMl: number;
	/** Базовый обмен: сколько тело тратит в покое. */
	bmr: number;
	/** Полный расход с поправкой на активность. */
	tdee: number;
}

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
	low: 1.2,
	light: 1.375,
	medium: 1.55,
	high: 1.725,
	athlete: 1.9
};

export const ACTIVITY_LABELS: Record<ActivityLevel, { title: string; hint: string }> = {
	low: { title: 'Сидячий', hint: 'офис, мало движения' },
	light: { title: 'Лёгкая', hint: 'прогулки, 1–2 тренировки' },
	medium: { title: 'Средняя', hint: '3–4 тренировки в неделю' },
	high: { title: 'Высокая', hint: '5–6 тренировок или физический труд' },
	athlete: { title: 'Очень высокая', hint: 'спорт дважды в день' }
};

export const GOAL_LABELS: Record<WeightGoal, { title: string; hint: string }> = {
	lose: { title: 'Снизить вес', hint: 'дефицит около 15 %' },
	maintain: { title: 'Удержать', hint: 'без дефицита и профицита' },
	gain: { title: 'Набрать', hint: 'профицит около 12 %' }
};

/** Поправка к расходу под цель. Агрессивнее — вредно и не держится. */
const GOAL_FACTORS: Record<WeightGoal, number> = {
	lose: 0.85,
	maintain: 1,
	gain: 1.12
};

/**
 * Нижняя граница калорий.
 *
 * Дефицит ниже этого уровня перестаёт быть похудением и становится проблемой
 * со здоровьем, поэтому расчёт туда не опускается даже при агрессивных
 * исходных данных.
 */
const MIN_CALORIES: Record<Sex, number> = { male: 1500, female: 1200 };

/** Белок на килограмм веса. При дефиците его поднимают, чтобы удержать мышцы. */
const PROTEIN_PER_KG: Record<WeightGoal, number> = { lose: 2, maintain: 1.7, gain: 1.8 };

/** Жир на килограмм. Ниже — страдают гормоны, это не место для экономии. */
const FAT_PER_KG = 0.9;

const CALORIES_PER_GRAM = { protein: 4, fat: 9, carbs: 4 };

/** Вода: 30 мл на килограмм — общепринятая грубая норма. */
const WATER_ML_PER_KG = 30;

export const PROFILE_LIMITS = {
	age: { min: 10, max: 100 },
	heightCm: { min: 100, max: 250 },
	weightKg: { min: 30, max: 300 }
};

export function validateProfile(draft: Partial<ProfileInput>): Record<string, string> {
	const errors: Record<string, string> = {};

	if (draft.sex !== 'male' && draft.sex !== 'female') errors.sex = 'Выберите пол';

	const numbers: [keyof typeof PROFILE_LIMITS, string][] = [
		['age', 'Возраст'],
		['heightCm', 'Рост'],
		['weightKg', 'Вес']
	];

	for (const [field, label] of numbers) {
		const value = draft[field];
		const limits = PROFILE_LIMITS[field];

		if (typeof value !== 'number' || !Number.isFinite(value)) {
			errors[field] = `${label}: введите число`;
		} else if (value < limits.min || value > limits.max) {
			errors[field] = `${label}: от ${limits.min} до ${limits.max}`;
		}
	}

	if (!draft.activity || !(draft.activity in ACTIVITY_FACTORS)) {
		errors.activity = 'Выберите уровень активности';
	}

	if (!draft.goal || !(draft.goal in GOAL_FACTORS)) {
		errors.goal = 'Выберите цель';
	}

	return errors;
}

/** Базовый обмен по Миффлину–Сан Жеору, ккал в сутки. */
export function calculateBmr(input: ProfileInput): number {
	const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
	return Math.round(input.sex === 'male' ? base + 5 : base - 161);
}

/**
 * Полный расчёт целей.
 *
 * Порядок важен: сначала калории, затем белок и жир от веса тела, углеводы —
 * остаток. Считать наоборот (проценты от калорий) можно, но тогда при дефиците
 * белка получается слишком мало именно тогда, когда он нужнее всего.
 */
export function calculateGoals(input: ProfileInput): GoalSuggestion {
	const bmr = calculateBmr(input);
	const tdee = Math.round(bmr * ACTIVITY_FACTORS[input.activity]);

	const target = Math.round(tdee * GOAL_FACTORS[input.goal]);
	const calorieGoal = Math.max(MIN_CALORIES[input.sex], roundTo(target, 10));

	const proteinGoal = Math.round(input.weightKg * PROTEIN_PER_KG[input.goal]);
	const fatGoal = Math.round(input.weightKg * FAT_PER_KG);

	const macroCalories = proteinGoal * CALORIES_PER_GRAM.protein + fatGoal * CALORIES_PER_GRAM.fat;

	// Углеводы — остаток, но не отрицательный: у крупного человека с маленькой
	// целью белок и жир могут выбрать почти всю норму.
	const carbsGoal = Math.max(
		0,
		Math.round((calorieGoal - macroCalories) / CALORIES_PER_GRAM.carbs)
	);

	return {
		calorieGoal,
		proteinGoal,
		fatGoal,
		carbsGoal,
		waterGoalMl: roundTo(input.weightKg * WATER_ML_PER_KG, 100),
		bmr,
		tdee
	};
}

function roundTo(value: number, step: number): number {
	return Math.round(value / step) * step;
}
