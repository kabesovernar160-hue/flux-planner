import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { PLAN_KINDS, type PlanItem, type PlanKind } from '$lib/types/plan';
import { isDateKey, type DateKey } from '$lib/utils/date';
import type { ServiceResult } from './nutritionService';

/**
 * Цели на день.
 *
 * Проверка живёт отдельно от стора по той же причине, что у еды и финансов:
 * форма и разбор текста из чата должны получать одинаковые правила,
 * а стор обязан оставаться тем, что просто хранит.
 */

const MAX_TITLE_LENGTH = 120;
const MAX_NOTE_LENGTH = 300;

/** HH:MM в сутках. 24:00 не существует, 7:5 тоже. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type PlanDraft = {
	title: string;
	time?: string;
	kind?: PlanKind;
	note?: string;
	date?: DateKey;
};

export function validatePlanDraft(draft: Partial<PlanDraft>): Record<string, string> {
	const errors: Record<string, string> = {};

	if (typeof draft.title !== 'string' || draft.title.trim().length === 0) {
		errors.title = 'Укажите, что запланировано';
	} else if (draft.title.trim().length > MAX_TITLE_LENGTH) {
		errors.title = `Не длиннее ${MAX_TITLE_LENGTH} символов`;
	}

	if (draft.time !== undefined && draft.time !== '' && !TIME_PATTERN.test(draft.time)) {
		errors.time = 'Время в формате ЧЧ:ММ';
	}

	if (draft.kind !== undefined && !PLAN_KINDS.includes(draft.kind)) {
		errors.kind = 'Неизвестный тип';
	}

	if (draft.note !== undefined && draft.note.length > MAX_NOTE_LENGTH) {
		errors.note = `Заметка не длиннее ${MAX_NOTE_LENGTH} символов`;
	}

	if (draft.date !== undefined && !isDateKey(draft.date)) {
		errors.date = 'Некорректная дата';
	}

	return errors;
}

export function addPlanItem(draft: PlanDraft): ServiceResult<PlanItem> {
	const errors = validatePlanDraft(draft);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	const note = draft.note?.trim();

	return {
		ok: true,
		value: plannerStore.addPlanItem({
			title: draft.title.trim(),
			// Пустая строка и отсутствие времени должны означать одно и то же.
			time: draft.time ? draft.time : undefined,
			kind: draft.kind ?? 'task',
			note: note ? note : undefined,
			date: draft.date
		})
	};
}

export function updatePlanItem(id: string, patch: Partial<PlanDraft>): ServiceResult<null> {
	const existing = plannerStore.planItems.find((item) => item.id === id);
	if (!existing) return { ok: false, errors: { id: 'Пункт не найден' } };

	// Проверяется итоговое состояние записи, а не только присланные поля.
	const merged: PlanDraft = {
		title: patch.title ?? existing.title,
		time: patch.time ?? existing.time,
		kind: patch.kind ?? existing.kind,
		note: patch.note ?? existing.note,
		date: patch.date ?? existing.date
	};

	const errors = validatePlanDraft(merged);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	plannerStore.updatePlanItem(id, {
		title: merged.title.trim(),
		time: merged.time ? merged.time : undefined,
		kind: merged.kind ?? 'task',
		note: merged.note?.trim() || undefined,
		date: merged.date
	});

	return { ok: true, value: null };
}

export function togglePlanItem(id: string): boolean {
	return plannerStore.togglePlanItem(id);
}

export function removePlanItem(id: string): void {
	plannerStore.removePlanItem(id);
}

export function getPlanForDate(date: DateKey): PlanItem[] {
	return plannerStore.planItems
		.filter((item) => item.date === date)
		.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
}
