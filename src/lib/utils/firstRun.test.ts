import { describe, expect, it } from 'vitest';
import { hasAnyRecords, hasRecordSince, type RecordCollections } from './firstRun';

const empty = (): RecordCollections => ({
	foodEntries: [],
	habits: [],
	financeEntries: [],
	planItems: [],
	weightEntries: []
});

describe('hasAnyRecords', () => {
	it('пустое хранилище — записей нет', () => {
		expect(hasAnyRecords(empty())).toBe(false);
	});

	it('любая коллекция делает хранилище непустым', () => {
		for (const key of Object.keys(empty()) as (keyof RecordCollections)[]) {
			const data = empty();
			data[key] = [{ createdAt: '2026-09-24T08:00:00.000Z' }];
			expect(hasAnyRecords(data), key).toBe(true);
		}
	});
});

describe('hasRecordSince', () => {
	const since = '2026-09-24T08:00:00.000Z';

	it('запись после отметки — это действие человека', () => {
		const data = empty();
		data.habits = [{ createdAt: '2026-09-24T08:00:05.000Z' }];
		expect(hasRecordSince(data, since)).toBe(true);
	});

	it('запись из синхронизации старше отметки и не считается', () => {
		const data = empty();
		data.foodEntries = [{ createdAt: '2026-08-01T12:00:00.000Z' }];
		expect(hasRecordSince(data, since)).toBe(false);
	});
});
