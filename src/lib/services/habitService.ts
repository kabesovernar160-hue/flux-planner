import { plannerStore } from '$lib/stores/plannerStore.svelte';
import type { Habit, HabitFrequency } from '$lib/types/habit';
import { DEFAULT_HABIT_ICON, isHabitIconKey } from '$lib/icons/habit-icons';
import type { ServiceResult } from './nutritionService';
import type { DateKey } from '$lib/utils/date';
import { getStreakStats, type StreakStats } from '$lib/utils/streak';

const MAX_NAME_LENGTH = 60;
const FREQUENCIES: HabitFrequency[] = ['daily', 'weekdays', 'custom'];

export type HabitDraft = {
	name: string;
	icon?: string;
	frequency: HabitFrequency;
	targetDays?: number[];
};

export function validateHabitDraft(draft: Partial<HabitDraft>): Record<string, string> {
	const errors: Record<string, string> = {};

	if (typeof draft.name !== 'string' || draft.name.trim().length === 0) {
		errors.name = 'Укажите название';
	} else if (draft.name.trim().length > MAX_NAME_LENGTH) {
		errors.name = `Не длиннее ${MAX_NAME_LENGTH} символов`;
	}

	if (!draft.frequency || !FREQUENCIES.includes(draft.frequency)) {
		errors.frequency = 'Выберите периодичность';
	}

	// Расписание «по своим дням» без самих дней означало бы привычку,
	// которая не наступает никогда.
	if (draft.frequency === 'custom') {
		const days = draft.targetDays;
		if (!Array.isArray(days) || days.length === 0) {
			errors.targetDays = 'Выберите хотя бы один день недели';
		} else if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
			errors.targetDays = 'Дни недели задаются числами от 0 до 6';
		}
	}

	return errors;
}

export function createHabit(draft: HabitDraft): ServiceResult<Habit> {
	const errors = validateHabitDraft(draft);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	const icon = isHabitIconKey(draft.icon) ? draft.icon : DEFAULT_HABIT_ICON;

	return {
		ok: true,
		value: plannerStore.createHabit({
			name: draft.name.trim(),
			icon,
			frequency: draft.frequency,
			// Список дней хранится только для своего расписания: у daily и weekdays
			// он ни на что не влияет и только путал бы при чтении данных.
			targetDays: draft.frequency === 'custom' ? [...new Set(draft.targetDays)].sort() : undefined
		})
	};
}

export function updateHabit(id: string, patch: Partial<HabitDraft>): ServiceResult<null> {
	const existing = plannerStore.getHabit(id);
	if (!existing) return { ok: false, errors: { id: 'Привычка не найдена' } };

	// Проверяется итоговое состояние, а не присланные поля: смена периодичности
	// на custom без списка дней должна отвергаться, даже если дни не трогали.
	const merged: HabitDraft = {
		name: patch.name ?? existing.name,
		icon: patch.icon ?? existing.icon,
		frequency: patch.frequency ?? existing.frequency,
		targetDays: patch.targetDays ?? existing.targetDays
	};

	const errors = validateHabitDraft(merged);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	plannerStore.updateHabit(id, {
		name: merged.name.trim(),
		icon: isHabitIconKey(merged.icon) ? merged.icon : DEFAULT_HABIT_ICON,
		frequency: merged.frequency,
		targetDays: merged.frequency === 'custom' ? [...new Set(merged.targetDays)].sort() : undefined
	});

	return { ok: true, value: null };
}

export function deleteHabit(id: string): void {
	plannerStore.deleteHabit(id);
}

export function archiveHabit(id: string): void {
	plannerStore.archiveHabit(id);
}

export function restoreHabit(id: string): void {
	plannerStore.restoreHabit(id);
}

export function getHabit(id: string): Habit | undefined {
	return plannerStore.getHabit(id);
}

export function getActiveHabits(): Habit[] {
	return plannerStore.habits.filter((habit) => !habit.archived);
}

export function getArchivedHabits(): Habit[] {
	return plannerStore.habits.filter((habit) => habit.archived);
}

/* ───────────────────────────── Отметки ───────────────────────────── */

export function completeHabit(id: string, date?: DateKey): void {
	plannerStore.completeHabit(id, date ?? plannerStore.currentDate);
}

export function uncompleteHabit(id: string, date?: DateKey): void {
	plannerStore.uncompleteHabit(id, date ?? plannerStore.currentDate);
}

export function toggleHabit(id: string, date?: DateKey): boolean {
	return plannerStore.toggleHabit(id, date ?? plannerStore.currentDate);
}

export function isHabitCompleted(id: string, date?: DateKey): boolean {
	return plannerStore.isHabitCompleted(id, date ?? plannerStore.currentDate);
}

export function getHabitStreak(id: string, date?: DateKey): StreakStats | null {
	const habit = plannerStore.getHabit(id);
	if (!habit) return null;

	return getStreakStats(habit, plannerStore.habitCompletions, date ?? plannerStore.currentDate);
}
