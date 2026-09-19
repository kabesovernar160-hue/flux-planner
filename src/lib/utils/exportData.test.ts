import { describe, expect, it } from 'vitest';
import type { PlannerState } from '$lib/types/planner';
import { buildExport, exportFileName, toFoodCsv, toWeightCsv } from './exportData';

const NOW = '2026-01-15T10:00:00.000Z';

const state = {
	schemaVersion: 2,
	user: { telegramUserId: '987654', timezone: 'UTC', createdAt: NOW, updatedAt: NOW },
	settings: { calorieGoal: 2100 },
	nutrition: {},
	finance: {},
	foodEntries: [
		{
			id: '1',
			date: '2026-01-15',
			name: 'Гречка',
			grams: 250,
			calories: 275,
			protein: 10,
			fat: 2.8,
			carbs: 52.5,
			source: 'manual',
			createdAt: NOW,
			updatedAt: NOW
		}
	],
	habits: [],
	habitCompletions: [],
	financeEntries: []
} as unknown as PlannerState;

describe('buildExport', () => {
	it('собирает все коллекции', () => {
		const payload = buildExport(state, NOW);

		expect(payload.app).toBe('flux-planner');
		expect(payload.exportedAt).toBe(NOW);
		expect(payload.foodEntries).toHaveLength(1);
	});

	it('не выносит идентификатор Telegram в файл', () => {
		// Файл может уехать куда угодно, а для восстановления записей
		// идентификатор не нужен.
		expect(JSON.stringify(buildExport(state, NOW))).not.toContain('987654');
	});
});

describe('exportFileName', () => {
	it('содержит дату выгрузки', () => {
		expect(exportFileName(NOW)).toBe('flux-planner-2026-01-15.json');
	});
});

describe('toFoodCsv', () => {
	it('пишет заголовок и строки', () => {
		const csv = toFoodCsv(state.foodEntries);
		const [header, row] = csv.split('\n');

		expect(header).toBe('date,meal,name,grams,calories,protein,fat,carbs,source');
		// Приём пищи у старой записи пуст: выдумывать его для таблицы нельзя.
		expect(row).toBe('2026-01-15,,Гречка,250,275,10,2.8,52.5,manual');
	});

	it('экранирует запятые и кавычки в названии', () => {
		const tricky = [{ ...state.foodEntries[0], name: 'Салат "Цезарь", большой' }];

		expect(toFoodCsv(tricky).split('\n')[1]).toContain('"Салат ""Цезарь"", большой"');
	});

	it('пустой список даёт только заголовок', () => {
		expect(toFoodCsv([]).split('\n')).toHaveLength(1);
	});
});

describe('toWeightCsv', () => {
	const weight = (date: string, weightKg: number, note?: string) => ({
		id: date,
		date,
		weightKg,
		note,
		createdAt: `${date}T08:00:00.000Z`,
		updatedAt: `${date}T08:00:00.000Z`
	});

	it('пишет заголовок и строки по возрастанию дат', () => {
		const csv = toWeightCsv([weight('2026-01-15', 78.4), weight('2026-01-10', 79)]);

		expect(csv.split('\n')).toEqual(['date,weight_kg,note', '2026-01-10,79,', '2026-01-15,78.4,']);
	});

	it('экранирует запятые в заметке', () => {
		const csv = toWeightCsv([weight('2026-01-15', 78.4, 'утром, натощак')]);

		expect(csv.split('\n')[1]).toBe('2026-01-15,78.4,"утром, натощак"');
	});

	it('без записей отдаёт только заголовок', () => {
		expect(toWeightCsv([])).toBe('date,weight_kg,note');
	});
});
