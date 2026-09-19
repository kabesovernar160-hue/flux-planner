import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '$lib/db/localDb';
import { resetDriverForTests } from '$lib/db/storage';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { SCHEMA_VERSION } from '$lib/types/planner';
import { addFood } from './nutritionService';
import { importFromText } from './importService';

const DATE = '2026-01-15';

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();
	await plannerStore.reset();
	plannerStore.setDate(DATE);
});

const food = (id: string, name: string, calories: number, updatedAt: string) => ({
	id,
	date: DATE,
	name,
	calories,
	protein: 0,
	fat: 0,
	carbs: 0,
	source: 'manual',
	createdAt: '2026-01-15T08:00:00.000Z',
	updatedAt
});

const fileWith = (entries: unknown[], settings: Record<string, unknown> = {}) =>
	JSON.stringify({
		app: 'flux-planner',
		exportedAt: '2026-01-15T12:00:00.000Z',
		schemaVersion: SCHEMA_VERSION,
		settings,
		nutrition: {},
		finance: {},
		foodEntries: entries,
		habits: [],
		habitCompletions: [],
		financeEntries: [],
		planItems: [],
		weightEntries: []
	});

describe('importFromText', () => {
	it('добавляет записи из файла', () => {
		const result = importFromText(
			fileWith([food('f1', 'Овсянка', 320, '2026-01-15T08:00:00.000Z')])
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.added).toBe(1);
		expect(plannerStore.foodEntries[0].name).toBe('Овсянка');
	});

	it('повторный импорт того же файла ничего не удваивает', () => {
		// Идентификаторы сохраняются: запись из файла — это та же запись,
		// а не её копия.
		const text = fileWith([food('f1', 'Овсянка', 320, '2026-01-15T08:00:00.000Z')]);

		importFromText(text);
		const second = importFromText(text);

		expect(plannerStore.foodEntries).toHaveLength(1);
		expect(second.ok && second.value.skipped).toBe(1);
	});

	it('не откатывает более свежую запись', () => {
		// «Восстановить» не должно означать «потерять сегодняшние правки».
		importFromText(fileWith([food('f1', 'Овсянка', 320, '2026-01-15T08:00:00.000Z')]));
		plannerStore.updateFoodEntry('f1', { calories: 400 });

		importFromText(fileWith([food('f1', 'Овсянка', 320, '2026-01-15T09:00:00.000Z')]));

		expect(plannerStore.foodEntries[0].calories).toBe(400);
	});

	it('более свежую версию из файла принимает', () => {
		importFromText(fileWith([food('f1', 'Овсянка', 320, '2026-01-15T08:00:00.000Z')]));
		importFromText(fileWith([food('f1', 'Овсянка с ягодами', 340, '2026-02-01T08:00:00.000Z')]));

		expect(plannerStore.foodEntries).toHaveLength(1);
		expect(plannerStore.foodEntries[0].calories).toBe(340);
	});

	it('в пустой дневник переносит и настройки', () => {
		const result = importFromText(
			fileWith([food('f1', 'Овсянка', 320, '2026-01-15T08:00:00.000Z')], {
				calorieGoal: 1700
			})
		);

		expect(result.ok && result.value.settingsApplied).toBe(true);
		expect(plannerStore.doc.settings.calorieGoal).toBe(1700);
	});

	it('в обжитом дневнике целей не трогает', () => {
		// Человек мог поменять цели вчера и не ждёт, что импорт истории
		// откатит их к прошлогодним.
		addFood({ name: 'Борщ', calories: 450, protein: 0, fat: 0, carbs: 0 });
		plannerStore.updateSettings({ calorieGoal: 2200 });

		const result = importFromText(
			fileWith([food('f1', 'Овсянка', 320, '2026-01-15T08:00:00.000Z')], {
				calorieGoal: 1700
			})
		);

		expect(result.ok && result.value.settingsApplied).toBe(false);
		expect(plannerStore.doc.settings.calorieGoal).toBe(2200);
	});

	it('чужой файл отклоняется целиком', () => {
		expect(importFromText('{"app":"other","foodEntries":[]}').ok).toBe(false);
		expect(importFromText('не json').ok).toBe(false);
		expect(plannerStore.foodEntries).toHaveLength(0);
	});

	it('файл более новой схемы не принимается', () => {
		const text = JSON.stringify({
			app: 'flux-planner',
			schemaVersion: SCHEMA_VERSION + 1,
			foodEntries: [food('f1', 'Овсянка', 320, '2026-01-15T08:00:00.000Z')]
		});

		expect(importFromText(text).ok).toBe(false);
		expect(plannerStore.foodEntries).toHaveLength(0);
	});

	it('битые строки пропускаются поштучно', () => {
		const result = importFromText(
			fileWith([food('f1', 'Овсянка', 320, '2026-01-15T08:00:00.000Z'), { name: 'без id' }])
		);

		expect(result.ok && result.value.added).toBe(1);
		expect(result.ok && result.value.skipped).toBe(1);
	});
});
