import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '$lib/db/localDb';
import { resetDriverForTests } from '$lib/db/storage';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import type { FoodScanItem } from '$lib/types/nutrition';
import { addDays } from '$lib/utils/date';
import { mealForTime } from '$lib/utils/meals';
import {
	addFood,
	addScannedFood,
	addWater,
	getFoodsForDate,
	getNutritionSummary,
	isFavoriteFood,
	quickLogFood,
	removeFood,
	removeWater,
	repeatMeal,
	toggleFavoriteFood,
	undoFoodEntries,
	updateFood,
	validateFoodDraft,
	WATER_GLASS_ML
} from './nutritionService';

const draft = (overrides = {}) => ({
	name: 'Овсянка',
	calories: 420,
	protein: 14,
	fat: 9,
	carbs: 68,
	...overrides
});

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();
	await plannerStore.reset();
});

describe('validateFoodDraft', () => {
	it('пропускает корректный черновик', () => {
		expect(validateFoodDraft(draft())).toEqual({});
	});

	it('требует название', () => {
		expect(validateFoodDraft(draft({ name: '' })).name).toBeDefined();
		expect(validateFoodDraft(draft({ name: '   ' })).name).toBeDefined();
	});

	it('отвергает отрицательные значения', () => {
		expect(validateFoodDraft(draft({ calories: -1 })).calories).toBeDefined();
		expect(validateFoodDraft(draft({ protein: -0.1 })).protein).toBeDefined();
	});

	it('отвергает нечисловые и бесконечные значения', () => {
		expect(validateFoodDraft(draft({ calories: Number.NaN })).calories).toBeDefined();
		expect(validateFoodDraft(draft({ fat: Number.POSITIVE_INFINITY })).fat).toBeDefined();
		expect(validateFoodDraft(draft({ carbs: '20' })).carbs).toBeDefined();
	});

	it('разрешает нули: продукт без жиров это нормально', () => {
		expect(validateFoodDraft(draft({ fat: 0, calories: 0 }))).toEqual({});
	});

	it('вес порции необязателен, но не может быть нулём или отрицательным', () => {
		expect(validateFoodDraft(draft())).toEqual({});
		expect(validateFoodDraft(draft({ grams: 0 })).grams).toBeDefined();
		expect(validateFoodDraft(draft({ grams: -5 })).grams).toBeDefined();
		expect(validateFoodDraft(draft({ grams: 320 }))).toEqual({});
	});

	it('отвергает абсурдные величины', () => {
		expect(validateFoodDraft(draft({ calories: 50_000 })).calories).toBeDefined();
	});

	it('собирает все ошибки сразу, а не только первую', () => {
		const errors = validateFoodDraft({ name: '', calories: -1, protein: -1 });
		expect(Object.keys(errors).sort()).toContain('name');
		expect(Object.keys(errors).length).toBeGreaterThanOrEqual(3);
	});
});

describe('addFood', () => {
	it('добавляет запись и пересчитывает итоги', () => {
		const result = addFood(draft());

		expect(result.ok).toBe(true);
		expect(plannerStore.caloriesConsumed).toBe(420);
	});

	it('обрезает пробелы в названии', () => {
		const result = addFood(draft({ name: '  Овсянка  ' }));
		expect(result.ok && result.value.name).toBe('Овсянка');
	});

	it('по умолчанию источник — ручной ввод', () => {
		const result = addFood(draft());
		expect(result.ok && result.value.source).toBe('manual');
	});

	it('сохраняет источник ai для распознанного блюда', () => {
		const result = addFood(draft({ source: 'ai' as const }));
		expect(result.ok && result.value.source).toBe('ai');
	});

	it('невалидный черновик не попадает в состояние', () => {
		const result = addFood(draft({ calories: -5 }));

		expect(result.ok).toBe(false);
		expect(plannerStore.foodEntries).toHaveLength(0);
	});
});

describe('addScannedFood', () => {
	const scanned = (overrides: Partial<FoodScanItem> = {}): FoodScanItem => ({
		id: 'scan-1',
		name: 'Куриная грудка',
		estimatedGrams: 150,
		calories: 248,
		protein: 46.5,
		fat: 5.4,
		carbs: 0,
		per100g: { calories: 165, protein: 31, fat: 3.6, carbs: 0 },
		nutritionSource: 'database',
		confidence: 0.85,
		...overrides
	});

	it('создаёт по записи на каждый компонент блюда', () => {
		const result = addScannedFood([
			scanned(),
			scanned({ id: 'scan-2', name: 'Рис отварной', estimatedGrams: 200, calories: 260 }),
			scanned({ id: 'scan-3', name: 'Овощи', estimatedGrams: 100, calories: 45 })
		]);

		expect(result.ok).toBe(true);
		expect(plannerStore.foodEntries).toHaveLength(3);
		expect(plannerStore.foodEntries.map((entry) => entry.name)).toEqual([
			'Куриная грудка',
			'Рис отварной',
			'Овощи'
		]);
	});

	it('помечает записи как распознанные и переносит вес порции', () => {
		addScannedFood([scanned()]);
		const [entry] = plannerStore.foodEntries;

		expect(entry.source).toBe('ai');
		expect(entry.grams).toBe(150);
		expect(entry.calories).toBe(248);
	});

	it('складывается в итог дня', () => {
		addScannedFood([scanned(), scanned({ id: 'scan-2', calories: 260, protein: 5.4 })]);

		expect(plannerStore.caloriesConsumed).toBe(508);
	});

	it('пустой список не сохраняет ничего', () => {
		expect(addScannedFood([]).ok).toBe(false);
		expect(plannerStore.foodEntries).toHaveLength(0);
	});

	it('не сохраняет половину блюда, если один компонент испорчен', () => {
		// Частично записанное блюдо хуже понятной ошибки: в дневнике
		// осталась бы курица без риса, и человек об этом не узнал бы.
		const result = addScannedFood([scanned(), scanned({ id: 'scan-2', calories: Number.NaN })]);

		expect(result.ok).toBe(false);
		expect(plannerStore.foodEntries).toHaveLength(0);
	});
});

describe('updateFood', () => {
	it('правит запись', () => {
		const added = addFood(draft());
		const id = added.ok ? added.value.id : '';

		expect(updateFood(id, { calories: 500 }).ok).toBe(true);
		expect(plannerStore.caloriesConsumed).toBe(500);
	});

	it('проверяет итоговое состояние записи, а не только присланные поля', () => {
		const added = addFood(draft());
		const id = added.ok ? added.value.id : '';

		const result = updateFood(id, { calories: -10 });

		expect(result.ok).toBe(false);
		// Старое значение осталось нетронутым.
		expect(plannerStore.caloriesConsumed).toBe(420);
	});

	it('сообщает о несуществующей записи', () => {
		expect(updateFood('нет-такого', { calories: 100 }).ok).toBe(false);
	});
});

describe('removeFood и getFoodsForDate', () => {
	it('удаляет запись', () => {
		const added = addFood(draft());
		removeFood(added.ok ? added.value.id : '');

		expect(plannerStore.foodEntries).toHaveLength(0);
	});

	it('отдаёт записи только за указанный день', () => {
		addFood(draft());
		addFood(draft({ date: '2020-01-01', name: 'Старое' }));

		expect(getFoodsForDate(plannerStore.currentDate)).toHaveLength(1);
		expect(getFoodsForDate('2020-01-01')).toHaveLength(1);
		expect(getFoodsForDate('1999-01-01')).toHaveLength(0);
	});
});

describe('вода', () => {
	it('стакан добавляет 250 мл', () => {
		addWater();
		expect(plannerStore.todayNutrition.waterConsumedMl).toBe(WATER_GLASS_ML);
	});

	it('накапливается', () => {
		addWater();
		addWater();
		expect(plannerStore.todayNutrition.waterConsumedMl).toBe(500);
	});

	it('не уходит ниже нуля', () => {
		addWater();
		removeWater(1000);
		expect(plannerStore.todayNutrition.waterConsumedMl).toBe(0);
	});
});

describe('getNutritionSummary', () => {
	it('собирает сводку из реальных записей', () => {
		addFood(draft({ calories: 1450, protein: 82, fat: 48, carbs: 165 }));
		addWater(1400);

		const summary = getNutritionSummary();

		expect(summary.totals.calories).toBe(1450);
		expect(summary.caloriesRemaining).toBe(2100 - 1450);
		expect(summary.water.consumedMl).toBe(1400);
		expect(summary.entryCount).toBe(1);
	});

	it('на пустом дне не даёт NaN', () => {
		const summary = getNutritionSummary();

		expect(summary.totals.calories).toBe(0);
		expect(Number.isFinite(summary.progress.calories)).toBe(true);
		expect(summary.progress.calories).toBe(0);
	});
});

describe('приёмы пищи', () => {
	const scanItem = (overrides: Partial<FoodScanItem> = {}): FoodScanItem => ({
		id: 'scan-1',
		name: 'Куриная грудка',
		estimatedGrams: 150,
		calories: 248,
		protein: 46.5,
		fat: 5.4,
		carbs: 0,
		per100g: { calories: 165, protein: 31, fat: 3.6, carbs: 0 },
		nutritionSource: 'database',
		confidence: 0.85,
		...overrides
	});

	it('новой записи приём подставляется по времени суток', () => {
		const result = addFood(draft());

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// Спрашивать «завтрак или обед?» в девять утра — лишний вопрос
		// с очевидным ответом.
		expect(result.value.meal).toBe(mealForTime());
	});

	it('явно выбранный приём не переписывается', () => {
		const result = addFood(draft({ meal: 'snack' }));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.meal).toBe('snack');
	});

	it('распознанное блюдо целиком попадает в один приём', () => {
		// Курица, рис и соус с одного снимка съедены за один раз:
		// раскладывать их по разным приёмам нелепо.
		const result = addScannedFood(
			[scanItem({ id: 's1', name: 'Курица' }), scanItem({ id: 's2', name: 'Рис' })],
			undefined,
			'dinner'
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.map((entry) => entry.meal)).toEqual(['dinner', 'dinner']);
	});

	it('приём можно перенести правкой записи', () => {
		const created = addFood(draft({ meal: 'lunch' }));
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		expect(updateFood(created.value.id, { meal: 'dinner' }).ok).toBe(true);
		expect(getFoodsForDate(plannerStore.currentDate)[0].meal).toBe('dinner');
	});

	it('правка других полей приём не теряет', () => {
		const created = addFood(draft({ meal: 'lunch' }));
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		updateFood(created.value.id, { calories: 500 });

		expect(getFoodsForDate(plannerStore.currentDate)[0].meal).toBe('lunch');
	});
});

describe('быстрая запись', () => {
	const oatmeal = { name: 'Овсянка', grams: 60, calories: 230, protein: 8, fat: 4, carbs: 40 };

	it('записывает блюдо с теми же граммами и цифрами', () => {
		const result = quickLogFood(oatmeal, 'breakfast');

		expect(result.ok).toBe(true);
		expect(plannerStore.todayFoods).toHaveLength(1);
		expect(plannerStore.todayFoods[0]).toMatchObject({ ...oatmeal, meal: 'breakfast' });
	});

	it('отмена убирает ровно созданное', () => {
		const kept = quickLogFood({ ...oatmeal, name: 'Кофе' });
		const result = quickLogFood(oatmeal);
		if (!result.ok || !kept.ok) throw new Error('не записалось');

		undoFoodEntries([result.value.id]);

		expect(plannerStore.todayFoods.map((entry) => entry.name)).toEqual(['Кофе']);
	});

	it('вчерашний приём повторяется целиком, в сегодняшний день и тот же приём', () => {
		const yesterday = addDays(plannerStore.currentDate, -1);
		const eggs = addFood({ ...oatmeal, name: 'Яйца', meal: 'breakfast', date: yesterday });
		const coffee = addFood({ ...oatmeal, name: 'Кофе', meal: 'breakfast', date: yesterday });
		if (!eggs.ok || !coffee.ok) throw new Error('не записалось');

		const result = repeatMeal([eggs.value, coffee.value], 'breakfast');

		expect(result.ok).toBe(true);
		expect(plannerStore.todayFoods.map((entry) => [entry.name, entry.meal])).toEqual([
			['Яйца', 'breakfast'],
			['Кофе', 'breakfast']
		]);

		if (result.ok) undoFoodEntries(result.value.map((entry) => entry.id));
		expect(plannerStore.todayFoods).toHaveLength(0);
		// Вчерашние записи отмена не трогает.
		expect(plannerStore.foodEntries).toHaveLength(2);
	});

	it('звёздочка сохраняется в настройках и двигает их отметку для синхронизации', () => {
		const before = plannerStore.doc.settingsUpdatedAt;

		expect(toggleFavoriteFood(oatmeal)).toBe(true);
		expect(isFavoriteFood('овсянка')).toBe(true);
		expect(plannerStore.doc.settingsUpdatedAt).not.toBe(before);

		expect(toggleFavoriteFood(oatmeal)).toBe(false);
		expect(isFavoriteFood('Овсянка')).toBe(false);
	});
});
