import { describe, expect, it } from 'vitest';
import { isSyncRow, MAX_ROWS_PER_COLLECTION, parsePushPayload } from './protocol';

const row = (overrides: Record<string, unknown> = {}) => ({
	id: 'a1',
	createdAt: '2026-01-15T08:00:00.000Z',
	updatedAt: '2026-01-15T08:00:00.000Z',
	...overrides
});

describe('isSyncRow', () => {
	it('принимает корректную запись', () => {
		expect(isSyncRow(row())).toBe(true);
	});

	it('принимает надгробие', () => {
		expect(isSyncRow(row({ deletedAt: '2026-01-15T09:00:00.000Z' }))).toBe(true);
		expect(isSyncRow(row({ deletedAt: null }))).toBe(true);
	});

	it('отвергает запись без ключа', () => {
		expect(isSyncRow(row({ id: '' }))).toBe(false);
		expect(isSyncRow(row({ id: 42 }))).toBe(false);
	});

	it('отвергает нечитаемые отметки времени', () => {
		expect(isSyncRow(row({ updatedAt: 'вчера' }))).toBe(false);
		expect(isSyncRow(row({ createdAt: 1737000000 }))).toBe(false);
	});

	it('отвергает не-объект', () => {
		expect(isSyncRow(null)).toBe(false);
		expect(isSyncRow([])).toBe(false);
		expect(isSyncRow('строка')).toBe(false);
	});
});

describe('parsePushPayload', () => {
	it('разбирает корректный пакет', () => {
		const parsed = parsePushPayload({ changes: { food: [row()], habits: [] } });

		expect(parsed.ok).toBe(true);
		expect(parsed.ok && parsed.payload.food).toHaveLength(1);
	});

	it('требует объект с полем changes', () => {
		expect(parsePushPayload(null).ok).toBe(false);
		expect(parsePushPayload({}).ok).toBe(false);
		expect(parsePushPayload({ changes: 'нет' }).ok).toBe(false);
	});

	it('отвергает коллекцию, которая не массив', () => {
		expect(parsePushPayload({ changes: { food: { id: 'a1' } } }).ok).toBe(false);
	});

	it('отбрасывает битые записи, не роняя весь пакет', () => {
		// Одна испорченная строка не должна блокировать синхронизацию остальных.
		const parsed = parsePushPayload({
			changes: { food: [row(), { сломано: true }, row({ id: 'a2' })] }
		});

		expect(parsed.ok && parsed.payload.food?.map((item) => item.id)).toEqual(['a1', 'a2']);
	});

	it('игнорирует незнакомые коллекции', () => {
		// Старый сервер не должен падать от коллекции, которую добавил новый клиент.
		const parsed = parsePushPayload({ changes: { food: [row()], будущее: [row()] } });

		expect(parsed.ok).toBe(true);
		expect(parsed.ok && Object.keys(parsed.payload)).toEqual(['food']);
	});

	it('отвергает слишком большой пакет', () => {
		const huge = Array.from({ length: MAX_ROWS_PER_COLLECTION + 1 }, (_, i) =>
			row({ id: `a${i}` })
		);

		expect(parsePushPayload({ changes: { food: huge } }).ok).toBe(false);
	});

	it('пустой пакет допустим', () => {
		const parsed = parsePushPayload({ changes: {} });
		expect(parsed.ok && Object.keys(parsed.payload)).toEqual([]);
	});
});
