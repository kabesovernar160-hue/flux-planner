import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '$lib/db/localDb';
import { resetDriverForTests } from '$lib/db/storage';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { addDays, getToday } from '$lib/utils/date';
import {
	archiveHabit,
	completeHabit,
	createHabit,
	deleteHabit,
	getActiveHabits,
	getArchivedHabits,
	getHabitStreak,
	isHabitCompleted,
	restoreHabit,
	toggleHabit,
	updateHabit,
	validateHabitDraft
} from './habitService';

const draft = (overrides = {}) => ({
	name: 'Зарядка',
	icon: 'barbell',
	frequency: 'daily' as const,
	...overrides
});

const id = (result: ReturnType<typeof createHabit>) => (result.ok ? result.value.id : '');

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();
	await plannerStore.reset();
});

describe('validateHabitDraft', () => {
	it('пропускает корректный черновик', () => {
		expect(validateHabitDraft(draft())).toEqual({});
	});

	it('требует название', () => {
		expect(validateHabitDraft(draft({ name: '  ' })).name).toBeDefined();
	});

	it('ограничивает длину названия', () => {
		expect(validateHabitDraft(draft({ name: 'а'.repeat(61) })).name).toBeDefined();
	});

	it('требует известную периодичность', () => {
		expect(validateHabitDraft(draft({ frequency: 'ежечасно' })).frequency).toBeDefined();
		expect(validateHabitDraft({ name: 'Без периодичности' }).frequency).toBeDefined();
	});

	it('своё расписание без дней отвергается', () => {
		// Иначе получилась бы привычка, которая не наступает никогда.
		expect(validateHabitDraft(draft({ frequency: 'custom' })).targetDays).toBeDefined();
		expect(
			validateHabitDraft(draft({ frequency: 'custom', targetDays: [] })).targetDays
		).toBeDefined();
	});

	it('отвергает недопустимые номера дней', () => {
		expect(
			validateHabitDraft(draft({ frequency: 'custom', targetDays: [7] })).targetDays
		).toBeDefined();
		expect(
			validateHabitDraft(draft({ frequency: 'custom', targetDays: [1.5] })).targetDays
		).toBeDefined();
	});
});

describe('createHabit', () => {
	it('создаёт привычку', () => {
		const result = createHabit(draft());

		expect(result.ok).toBe(true);
		expect(getActiveHabits()).toHaveLength(1);
	});

	it('обрезает пробелы в названии', () => {
		const result = createHabit(draft({ name: '  Зарядка  ' }));
		expect(result.ok && result.value.name).toBe('Зарядка');
	});

	it('неизвестный ключ иконки заменяется запасным', () => {
		const result = createHabit(draft({ icon: 'такой-иконки-нет' }));
		expect(result.ok && result.value.icon).toBe('check');
	});

	it('дни недели сортируются и дедуплицируются', () => {
		const result = createHabit(draft({ frequency: 'custom', targetDays: [4, 2, 4] }));
		expect(result.ok && result.value.targetDays).toEqual([2, 4]);
	});

	it('для daily список дней не сохраняется', () => {
		const result = createHabit(draft({ targetDays: [1, 2] }));
		expect(result.ok && result.value.targetDays).toBeUndefined();
	});

	it('невалидный черновик не попадает в состояние', () => {
		expect(createHabit(draft({ name: '' })).ok).toBe(false);
		expect(plannerStore.habits).toHaveLength(0);
	});
});

describe('updateHabit', () => {
	it('меняет название', () => {
		const habitId = id(createHabit(draft()));

		expect(updateHabit(habitId, { name: 'Пробежка' }).ok).toBe(true);
		expect(getActiveHabits()[0].name).toBe('Пробежка');
	});

	it('смена на своё расписание без дней отвергается', () => {
		// Проверяется итоговое состояние, а не только присланные поля.
		const habitId = id(createHabit(draft()));

		expect(updateHabit(habitId, { frequency: 'custom' }).ok).toBe(false);
		expect(getActiveHabits()[0].frequency).toBe('daily');
	});

	it('смена на своё расписание с днями проходит', () => {
		const habitId = id(createHabit(draft()));

		expect(updateHabit(habitId, { frequency: 'custom', targetDays: [1, 3] }).ok).toBe(true);
		expect(getActiveHabits()[0].targetDays).toEqual([1, 3]);
	});

	it('при переходе обратно на daily список дней очищается', () => {
		const habitId = id(createHabit(draft({ frequency: 'custom', targetDays: [1] })));
		updateHabit(habitId, { frequency: 'daily' });

		expect(getActiveHabits()[0].targetDays).toBeUndefined();
	});

	it('сообщает о несуществующей привычке', () => {
		expect(updateHabit('нет-такой', { name: 'X' }).ok).toBe(false);
	});
});

describe('архив', () => {
	it('архивная привычка уходит из активных, но история остаётся', () => {
		const habitId = id(createHabit(draft()));
		completeHabit(habitId);
		archiveHabit(habitId);

		expect(getActiveHabits()).toHaveLength(0);
		expect(getArchivedHabits()).toHaveLength(1);
		expect(plannerStore.habitCompletions).toHaveLength(1);
	});

	it('возврат из архива восстанавливает привычку', () => {
		const habitId = id(createHabit(draft()));
		archiveHabit(habitId);
		restoreHabit(habitId);

		expect(getActiveHabits()).toHaveLength(1);
	});
});

describe('отметки', () => {
	it('переключаются в обе стороны', () => {
		const habitId = id(createHabit(draft()));

		expect(toggleHabit(habitId)).toBe(true);
		expect(isHabitCompleted(habitId)).toBe(true);
		expect(toggleHabit(habitId)).toBe(false);
		expect(isHabitCompleted(habitId)).toBe(false);
	});

	it('повторное выполнение не плодит записи', () => {
		const habitId = id(createHabit(draft()));
		completeHabit(habitId);
		completeHabit(habitId);

		expect(plannerStore.habitCompletions).toHaveLength(1);
	});

	it('отметка за прошлый день не трогает сегодняшнюю', () => {
		const habitId = id(createHabit(draft()));
		completeHabit(habitId, addDays(getToday(), -1));

		expect(isHabitCompleted(habitId)).toBe(false);
		expect(isHabitCompleted(habitId, addDays(getToday(), -1))).toBe(true);
	});
});

describe('deleteHabit', () => {
	it('удаляет привычку вместе с её историей', () => {
		const habitId = id(createHabit(draft()));
		completeHabit(habitId);
		deleteHabit(habitId);

		expect(plannerStore.habits).toHaveLength(0);
		expect(plannerStore.habitCompletions).toHaveLength(0);
	});

	it('не трогает историю других привычек', () => {
		const first = id(createHabit(draft({ name: 'Первая' })));
		const second = id(createHabit(draft({ name: 'Вторая' })));
		completeHabit(first);
		completeHabit(second);

		deleteHabit(first);

		expect(plannerStore.habitCompletions).toHaveLength(1);
		expect(plannerStore.habitCompletions[0].habitId).toBe(second);
	});
});

describe('getHabitStreak', () => {
	it('отдаёт статистику по привычке', () => {
		const habitId = id(createHabit(draft()));
		completeHabit(habitId);

		const stats = getHabitStreak(habitId);

		expect(stats?.current).toBe(1);
		expect(stats?.totalCompleted).toBe(1);
		expect(stats?.lastCompletedDate).toBe(getToday());
	});

	it('для несуществующей привычки возвращает null', () => {
		expect(getHabitStreak('нет-такой')).toBeNull();
	});
});
