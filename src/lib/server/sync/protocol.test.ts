import { describe, expect, it } from 'vitest';
import { activeFavorites, toggleFavorite } from '$lib/utils/favorites';
import {
	isSyncRow,
	MAX_ROWS_PER_COLLECTION,
	mergePlannerSettings,
	parsePushPayload
} from './protocol';

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

describe('mergePlannerSettings', () => {
	const stored = {
		calorieGoal: 2460,
		onboardedAt: '2026-01-10T08:00:00.000Z',
		profile: { sex: 'male', age: 30 }
	};

	it('пришедшие настройки побеждают целиком', () => {
		const merged = mergePlannerSettings(stored, {
			calorieGoal: 1700,
			onboardedAt: '2026-02-01T08:00:00.000Z'
		}) as Record<string, unknown>;

		expect(merged.calorieGoal).toBe(1700);
		expect(merged.onboardedAt).toBe('2026-02-01T08:00:00.000Z');
	});

	it('пройденный первый запуск и анкета не стираются', () => {
		// Устройство с почищенным хранилищем присылает настройки без них.
		// Это «ещё не знаю», а не «человек передумал».
		const merged = mergePlannerSettings(stored, { calorieGoal: 2100 }) as Record<string, unknown>;

		expect(merged.onboardedAt).toBe('2026-01-10T08:00:00.000Z');
		expect(merged.profile).toEqual(stored.profile);
		expect(merged.calorieGoal).toBe(2100);
	});

	it('избранное сливается поштучно, а не побеждает целиком', () => {
		const oatmeal = toggleFavorite(
			[],
			{ name: 'Овсянка', calories: 230, protein: 8, fat: 4, carbs: 40 },
			'2026-01-10T08:00:00.000Z'
		);
		const soup = toggleFavorite(
			[],
			{ name: 'Борщ', calories: 180, protein: 6, fat: 7, carbs: 20 },
			'2026-01-10T09:00:00.000Z'
		);

		const merged = mergePlannerSettings(
			{ ...stored, favoriteFoods: oatmeal },
			{ calorieGoal: 2100, favoriteFoods: soup }
		) as Record<string, unknown>;

		expect(activeFavorites(merged.favoriteFoods).map((item) => item.name)).toEqual([
			'Борщ',
			'Овсянка'
		]);
	});

	it('старый клиент без избранного его не стирает', () => {
		const oatmeal = toggleFavorite(
			[],
			{ name: 'Овсянка', calories: 230, protein: 8, fat: 4, carbs: 40 },
			'2026-01-10T08:00:00.000Z'
		);

		const merged = mergePlannerSettings(
			{ ...stored, favoriteFoods: oatmeal },
			{
				calorieGoal: 2100
			}
		) as Record<string, unknown>;

		expect(activeFavorites(merged.favoriteFoods)).toHaveLength(1);
	});

	it('без сохранённых настроек отдаёт пришедшие как есть', () => {
		expect(mergePlannerSettings(null, { calorieGoal: 2100 })).toEqual({ calorieGoal: 2100 });
		expect(mergePlannerSettings(undefined, 'мусор')).toBe('мусор');
	});
});
