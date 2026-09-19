import { plannerStore, type ImportSummary } from '$lib/stores/plannerStore.svelte';
import { IMPORT_PROBLEM_TEXT, parseExport } from '$lib/utils/importData';
import type { ServiceResult } from './nutritionService';

/**
 * Восстановление из файла выгрузки.
 *
 * Слияние, а не замена: файл вчерашний, а в приложении могли появиться
 * сегодняшние записи, и «восстановить» не должно означать «потерять».
 * Побеждает более свежая версия каждой записи.
 */

export interface ImportResult extends ImportSummary {
	/** Применены ли настройки из файла. */
	settingsApplied: boolean;
}

/**
 * Настройки берутся из файла, только когда дневник пуст.
 *
 * Пустой дневник — это восстановление после сброса или переезд, там цели
 * из файла и нужны. В обжитом приложении файл добавляет записи, но не трогает
 * цели: человек мог поменять их вчера и не ждёт, что импорт истории откатит
 * их к прошлогодним.
 */
function diaryIsEmpty(): boolean {
	return (
		plannerStore.foodEntries.length === 0 &&
		plannerStore.habits.length === 0 &&
		plannerStore.financeEntries.length === 0 &&
		plannerStore.planItems.length === 0 &&
		plannerStore.weightEntries.length === 0
	);
}

export function importFromText(text: string): ServiceResult<ImportResult> {
	const parsed = parseExport(text);

	if (!parsed.ok) {
		return { ok: false, errors: { file: IMPORT_PROBLEM_TEXT[parsed.problem] } };
	}

	const { payload } = parsed.value;
	const applySettings = diaryIsEmpty();

	const summary = plannerStore.importRecords({
		foodEntries: payload.foodEntries,
		habits: payload.habits,
		habitCompletions: payload.habitCompletions,
		financeEntries: payload.financeEntries,
		planItems: payload.planItems,
		weightEntries: payload.weightEntries,
		nutrition: payload.nutrition,
		finance: payload.finance
	});

	if (applySettings && payload.settings) {
		plannerStore.updateSettings(payload.settings);
	}

	return { ok: true, value: { ...summary, settingsApplied: applySettings } };
}

export async function importFromFile(file: File): Promise<ServiceResult<ImportResult>> {
	// Потолок на размер: годовая история весит сотни килобайт, а файл
	// в десятки мегабайт — это не выгрузка, и читать его в память незачем.
	const MAX_BYTES = 20 * 1024 * 1024;

	if (file.size > MAX_BYTES) {
		return { ok: false, errors: { file: 'Файл слишком большой для выгрузки Flux Planner' } };
	}

	try {
		return importFromText(await file.text());
	} catch {
		return { ok: false, errors: { file: 'Не удалось прочитать файл' } };
	}
}
