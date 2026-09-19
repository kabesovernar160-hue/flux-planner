import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '$lib/db/localDb';
import { resetDriverForTests } from '$lib/db/storage';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { saveProfile } from './profileService';
import {
	getWeight,
	goalsOutOfDate,
	latestWeight,
	recordWeight,
	refreshGoalsFromWeight,
	removeWeight,
	validateWeight,
	weightChange,
	weightSeries
} from './weightService';

const TODAY = '2026-01-15';

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();
	await plannerStore.reset();
	plannerStore.setDate(TODAY);
});

describe('validateWeight', () => {
	it('пропускает обычный вес', () => {
		expect(validateWeight(78.4)).toEqual({});
	});

	it('ловит промах по клавиатуре', () => {
		// «7.8» вместо «78» и «780» вместо «78,0» — обычные опечатки,
		// и в графике они рисуют обрыв, который потом ищут глазами.
		expect(validateWeight(7.8).weightKg).toBeDefined();
		expect(validateWeight(780).weightKg).toBeDefined();
	});

	it('требует число', () => {
		expect(validateWeight('78').weightKg).toBeDefined();
		expect(validateWeight(Number.NaN).weightKg).toBeDefined();
	});
});

describe('recordWeight', () => {
	it('записывает взвешивание за день', () => {
		const result = recordWeight(78.4);

		expect(result.ok).toBe(true);
		expect(getWeight(TODAY)?.weightKg).toBe(78.4);
	});

	it('повторное взвешивание в тот же день заменяет прежнее', () => {
		// Три цифры за сутки отличаются в основном содержимым желудка:
		// в графике это шум, а не динамика.
		recordWeight(78.4);
		recordWeight(78.1);

		expect(plannerStore.weightEntries).toHaveLength(1);
		expect(getWeight(TODAY)?.weightKg).toBe(78.1);
	});

	it('отвергает значение за границами разумного', () => {
		expect(recordWeight(780).ok).toBe(false);
		expect(plannerStore.weightEntries).toHaveLength(0);
	});

	it('удаление убирает запись дня', () => {
		recordWeight(78.4);
		removeWeight(TODAY);

		expect(getWeight(TODAY)).toBeUndefined();
	});

	it('последним считается позднейший день, а не последняя запись', () => {
		// Вес, добавленный задним числом за прошлую неделю, не делает
		// прошлую неделю «текущей».
		recordWeight(78, TODAY);
		recordWeight(80, '2026-01-10');

		expect(latestWeight()?.date).toBe(TODAY);
		expect(latestWeight()?.weightKg).toBe(78);
	});
});

describe('weightSeries и weightChange', () => {
	it('дни без взвешивания остаются нулями', () => {
		recordWeight(78, TODAY);

		const series = weightSeries(TODAY, 3);

		expect(series).toHaveLength(3);
		expect(series[0].value).toBe(0);
		expect(series[2].value).toBe(78);
	});

	it('изменение считается между первым и последним измерением', () => {
		recordWeight(80, '2026-01-13');
		recordWeight(79.5, '2026-01-14');
		recordWeight(78.8, TODAY);

		expect(weightChange(TODAY, 7)).toBe(-1.2);
	});

	it('на одном измерении динамики нет', () => {
		// Одна точка — это не динамика, и «−0,0 кг» по ней честнее не показывать.
		recordWeight(78, TODAY);

		expect(weightChange(TODAY, 7)).toBeNull();
	});
});

describe('пересчёт целей по весу', () => {
	const profile = {
		sex: 'male' as const,
		age: 30,
		heightCm: 180,
		weightKg: 80,
		activity: 'medium' as const,
		goal: 'lose' as const
	};

	it('без анкеты ничего не предлагает', () => {
		recordWeight(78);
		expect(goalsOutOfDate()).toBe(false);
	});

	it('мелкое расхождение не тревожит', () => {
		saveProfile(profile);
		recordWeight(79.5);

		expect(goalsOutOfDate()).toBe(false);
	});

	it('заметное расхождение предлагает пересчёт', () => {
		saveProfile(profile);
		recordWeight(76);

		expect(goalsOutOfDate()).toBe(true);
	});

	it('пересчёт меняет цели и вес в анкете, остальное оставляет', () => {
		saveProfile(profile);
		const before = plannerStore.doc.settings.calorieGoal;

		recordWeight(72);
		expect(refreshGoalsFromWeight().ok).toBe(true);

		expect(plannerStore.doc.settings.profile?.weightKg).toBe(72);
		expect(plannerStore.doc.settings.profile?.heightCm).toBe(180);
		expect(plannerStore.doc.settings.calorieGoal).toBeLessThan(before);
		expect(goalsOutOfDate()).toBe(false);
	});

	it('без анкеты пересчёт отвечает понятной ошибкой', () => {
		recordWeight(78);
		const result = refreshGoalsFromWeight();

		expect(result.ok).toBe(false);
	});
});
