import type { PlannerState } from '$lib/types/planner';

/**
 * Выгрузка данных пользователя.
 *
 * Для приложения, за которое платят, это не украшение: человек должен иметь
 * возможность забрать свои записи и уйти. Выгрузка делается на клиенте
 * из локального состояния — сервер для неё не нужен, и работает она офлайн.
 */

export interface ExportPayload {
	app: 'flux-planner';
	exportedAt: string;
	schemaVersion: number;
	settings: PlannerState['settings'];
	nutrition: PlannerState['nutrition'];
	finance: PlannerState['finance'];
	foodEntries: PlannerState['foodEntries'];
	habits: PlannerState['habits'];
	habitCompletions: PlannerState['habitCompletions'];
	financeEntries: PlannerState['financeEntries'];
	planItems: PlannerState['planItems'];
}

/**
 * Снимок состояния для выгрузки.
 *
 * Идентификатор Telegram намеренно не включается: файл может уехать куда
 * угодно, а для восстановления записей он не нужен.
 */
export function buildExport(state: PlannerState, now: string): ExportPayload {
	return {
		app: 'flux-planner',
		exportedAt: now,
		schemaVersion: state.schemaVersion,
		settings: state.settings,
		nutrition: state.nutrition,
		finance: state.finance,
		foodEntries: state.foodEntries,
		habits: state.habits,
		habitCompletions: state.habitCompletions,
		financeEntries: state.financeEntries,
		planItems: state.planItems
	};
}

/** Имя файла с датой: в загрузках их может накопиться несколько. */
export function exportFileName(now: string): string {
	return `flux-planner-${now.slice(0, 10)}.json`;
}

/**
 * Таблица записей о еде.
 *
 * CSV нужен не вместо JSON, а рядом: его открывает любая таблица, и это
 * единственный формат, с которым человек что-то сделает без программиста.
 */
export function toFoodCsv(entries: PlannerState['foodEntries']): string {
	const header = ['date', 'name', 'grams', 'calories', 'protein', 'fat', 'carbs', 'source'];

	const escape = (value: unknown): string => {
		const text = value === undefined || value === null ? '' : String(value);
		// Кавычки и разделители внутри значения ломают разбор,
		// поэтому поле берётся в кавычки, а кавычки внутри удваиваются.
		return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	};

	const rows = entries.map((entry) =>
		[
			entry.date,
			entry.name,
			entry.grams ?? '',
			entry.calories,
			entry.protein,
			entry.fat,
			entry.carbs,
			entry.source
		]
			.map(escape)
			.join(',')
	);

	return [header.join(','), ...rows].join('\n');
}
