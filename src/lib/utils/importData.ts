import { SCHEMA_VERSION } from '$lib/types/planner';
import type { ExportPayload } from './exportData';

/**
 * Разбор файла выгрузки.
 *
 * Забрать данные приложение позволяло, вернуть — нет. Пара «выгрузка без
 * импорта» превращает файл в сувенир: им нельзя ни переехать на другой
 * аккаунт, ни восстановиться после сброса, а ровно для этого его и скачивают.
 *
 * Разбор отделён от применения намеренно: проверять чужой файл нужно до того,
 * как хоть одна строка попала в хранилище. Наполовину принятый импорт хуже
 * отклонённого.
 */

export type ImportProblem = 'NOT_JSON' | 'NOT_EXPORT' | 'TOO_NEW' | 'EMPTY';

export const IMPORT_PROBLEM_TEXT: Record<ImportProblem, string> = {
	NOT_JSON: 'Это не файл выгрузки: не удалось разобрать JSON',
	NOT_EXPORT: 'Файл не похож на выгрузку Flux Planner',
	TOO_NEW: 'Файл сделан более новой версией приложения — обновите его',
	EMPTY: 'В файле нет ни одной записи'
};

export interface ParsedExport {
	payload: ExportPayload;
	/** Сколько записей в файле. Показывается человеку до применения. */
	total: number;
}

export type ImportParse = { ok: true; value: ParsedExport } | { ok: false; problem: ImportProblem };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asMap(value: unknown): Record<string, Record<string, unknown>> {
	if (!isRecord(value)) return {};

	const result: Record<string, Record<string, unknown>> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (isRecord(entry)) result[key] = entry;
	}
	return result;
}

export function parseExport(text: string): ImportParse {
	let raw: unknown;

	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, problem: 'NOT_JSON' };
	}

	if (!isRecord(raw) || raw.app !== 'flux-planner') {
		// Проверяем метку приложения, а не просто наличие полей: чужой JSON
		// с похожими ключами лучше отклонить, чем частично принять.
		return { ok: false, problem: 'NOT_EXPORT' };
	}

	const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
	if (version > SCHEMA_VERSION) {
		// Поля могли поменять смысл. Молча принять такой файл — значит
		// испортить данные способом, который человек заметит нескоро.
		return { ok: false, problem: 'TOO_NEW' };
	}

	const payload = {
		app: 'flux-planner',
		exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
		schemaVersion: version,
		settings: isRecord(raw.settings) ? raw.settings : {},
		nutrition: asMap(raw.nutrition),
		finance: asMap(raw.finance),
		foodEntries: asArray(raw.foodEntries),
		habits: asArray(raw.habits),
		habitCompletions: asArray(raw.habitCompletions),
		financeEntries: asArray(raw.financeEntries),
		planItems: asArray(raw.planItems),
		weightEntries: asArray(raw.weightEntries)
	} as unknown as ExportPayload;

	const total =
		payload.foodEntries.length +
		payload.habits.length +
		payload.habitCompletions.length +
		payload.financeEntries.length +
		payload.planItems.length +
		payload.weightEntries.length +
		Object.keys(payload.nutrition).length +
		Object.keys(payload.finance).length;

	if (total === 0) return { ok: false, problem: 'EMPTY' };

	return { ok: true, value: { payload, total } };
}
