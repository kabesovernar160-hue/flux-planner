import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '$lib/db/localDb';
import { resetDriverForTests } from '$lib/db/storage';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import {
	addPlanItem,
	getPlanForDate,
	removePlanItem,
	togglePlanItem,
	updatePlanItem,
	validatePlanDraft
} from './planService';

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();
	await plannerStore.reset();
});

describe('validatePlanDraft', () => {
	it('пропускает корректный пункт', () => {
		expect(validatePlanDraft({ title: 'Ужин', time: '19:00' })).toEqual({});
	});

	it('требует название', () => {
		expect(validatePlanDraft({ title: '   ' }).title).toBeDefined();
	});

	it('проверяет формат времени', () => {
		expect(validatePlanDraft({ title: 'Ужин', time: '19:00' }).time).toBeUndefined();
		expect(validatePlanDraft({ title: 'Ужин', time: '25:00' }).time).toBeDefined();
		expect(validatePlanDraft({ title: 'Ужин', time: 'вечером' }).time).toBeDefined();
	});

	it('пустое время считает отсутствующим, а не ошибкой', () => {
		expect(validatePlanDraft({ title: 'Ужин', time: '' }).time).toBeUndefined();
	});
});

describe('addPlanItem', () => {
	it('добавляет пункт на текущий день', () => {
		const result = addPlanItem({ title: 'Ужин', time: '19:00' });

		expect(result.ok).toBe(true);
		expect(plannerStore.todayPlan).toHaveLength(1);
		expect(plannerStore.todayPlan[0].done).toBe(false);
	});

	it('по умолчанию тип — дело', () => {
		addPlanItem({ title: 'Позвонить врачу' });

		expect(plannerStore.todayPlan[0].kind).toBe('task');
	});

	it('не сохраняет пустое время', () => {
		addPlanItem({ title: 'Прогулка', time: '' });

		expect(plannerStore.todayPlan[0].time).toBeUndefined();
	});

	it('сортирует день по времени, пункты без времени — в конце', () => {
		addPlanItem({ title: 'Без времени' });
		addPlanItem({ title: 'Вечер', time: '19:00' });
		addPlanItem({ title: 'Утро', time: '08:00' });

		expect(plannerStore.todayPlan.map((item) => item.title)).toEqual([
			'Утро',
			'Вечер',
			'Без времени'
		]);
	});
});

describe('togglePlanItem', () => {
	it('отмечает и снимает отметку', () => {
		const created = addPlanItem({ title: 'Ужин' });
		const id = created.ok ? created.value.id : '';

		expect(togglePlanItem(id)).toBe(true);
		expect(plannerStore.donePlanItems).toHaveLength(1);

		expect(togglePlanItem(id)).toBe(false);
		expect(plannerStore.donePlanItems).toHaveLength(0);
	});

	it('прогресс считается от числа пунктов', () => {
		const first = addPlanItem({ title: 'Раз' });
		addPlanItem({ title: 'Два' });

		togglePlanItem(first.ok ? first.value.id : '');

		expect(plannerStore.planProgress).toBe(0.5);
	});
});

describe('updatePlanItem и removePlanItem', () => {
	it('правит название и время', () => {
		const created = addPlanItem({ title: 'Ужин' });
		const id = created.ok ? created.value.id : '';

		expect(updatePlanItem(id, { title: 'Поздний ужин', time: '21:30' }).ok).toBe(true);
		expect(plannerStore.todayPlan[0]).toMatchObject({ title: 'Поздний ужин', time: '21:30' });
	});

	it('отвергает некорректное время', () => {
		const created = addPlanItem({ title: 'Ужин' });
		const id = created.ok ? created.value.id : '';

		expect(updatePlanItem(id, { time: '99:99' }).ok).toBe(false);
	});

	it('удаляет пункт', () => {
		const created = addPlanItem({ title: 'Ужин' });
		removePlanItem(created.ok ? created.value.id : '');

		expect(plannerStore.todayPlan).toHaveLength(0);
	});
});

describe('getPlanForDate', () => {
	it('отдаёт пункты нужного дня', () => {
		addPlanItem({ title: 'Сегодня' });
		addPlanItem({ title: 'Другой день', date: '2026-01-01' });

		expect(getPlanForDate('2026-01-01').map((item) => item.title)).toEqual(['Другой день']);
	});
});
