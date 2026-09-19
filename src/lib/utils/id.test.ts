import { describe, expect, it } from 'vitest';
import { createId } from './id';

describe('createId', () => {
	it('возвращает непустую строку', () => {
		expect(createId().length).toBeGreaterThan(0);
	});

	it('не повторяется на большом объёме', () => {
		const ids = new Set(Array.from({ length: 10_000 }, () => createId()));
		expect(ids.size).toBe(10_000);
	});

	it('сортируется лексикографически в порядке создания', () => {
		// Именно на это опирается порядок записей после чтения из IndexedDB:
		// getAll отдаёт их в порядке первичного ключа.
		const ids = Array.from({ length: 500 }, () => createId());
		const sorted = [...ids].sort();

		expect(sorted).toEqual(ids);
	});

	it('сохраняет порядок при создании в одну миллисекунду', () => {
		const ids = Array.from({ length: 50 }, () => createId());
		expect([...ids].sort()).toEqual(ids);
	});
});
