import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from './client';
import { createRepositories, type Repositories, type SyncRow } from './repositories';

let db: Db;
let repositories: Repositories;

const ALICE = 'user-alice';
const BOB = 'user-bob';

async function makeUsers() {
	await repositories.users.upsertFromTelegram({
		id: ALICE,
		telegramUserId: '111',
		firstName: 'Алиса',
		now: '2026-01-15T08:00:00.000Z'
	});
	await repositories.users.upsertFromTelegram({
		id: BOB,
		telegramUserId: '222',
		firstName: 'Боб',
		now: '2026-01-15T08:00:00.000Z'
	});
}

const food = (id: string, overrides: Partial<Record<string, unknown>> = {}): SyncRow =>
	({
		id,
		createdAt: '2026-01-15T08:00:00.000Z',
		updatedAt: '2026-01-15T08:00:00.000Z',
		deletedAt: null,
		date: '2026-01-15',
		name: 'Овсянка',
		grams: 320,
		calories: 420,
		protein: 14,
		fat: 9,
		carbs: 68,
		source: 'manual',
		...overrides
	}) as SyncRow;

beforeEach(async () => {
	db = await createTestDb();
	repositories = createRepositories(db);
	await makeUsers();
});

describe('пользователи', () => {
	it('находятся по идентификатору Telegram', async () => {
		const found = await repositories.users.findByTelegramId('111');
		expect(found?.id).toBe(ALICE);
	});

	it('повторный вход не создаёт второго пользователя', async () => {
		await repositories.users.upsertFromTelegram({
			id: 'другой-id',
			telegramUserId: '111',
			firstName: 'Алиса',
			now: '2026-01-16T08:00:00.000Z'
		});

		expect(await repositories.users.listAll()).toHaveLength(2);
	});

	it('подтягивает изменившийся ник', async () => {
		await repositories.users.upsertFromTelegram({
			id: 'неважно',
			telegramUserId: '111',
			username: 'new_nick',
			now: '2026-01-16T08:00:00.000Z'
		});

		expect((await repositories.users.findByTelegramId('111'))?.username).toBe('new_nick');
	});
});

describe('изоляция пользователей', () => {
	it('чужие записи не видны', async () => {
		await repositories.food.upsertMany(ALICE, [food('a1')]);
		await repositories.food.upsertMany(BOB, [food('b1')]);

		const alice = await repositories.food.pullSince(ALICE, null);
		const bob = await repositories.food.pullSince(BOB, null);

		expect(alice.map((row) => row.id)).toEqual(['a1']);
		expect(bob.map((row) => row.id)).toEqual(['b1']);
	});

	it('подменённый user_id в теле запроса игнорируется', async () => {
		// Критический сценарий: клиент пытается записать данные в чужой аккаунт,
		// подставив чужой идентификатор в саму запись.
		const forged = { ...food('forged'), userId: BOB } as SyncRow;
		await repositories.food.upsertMany(ALICE, [forged]);

		expect(await repositories.food.pullSince(BOB, null)).toHaveLength(0);
		expect(await repositories.food.pullSince(ALICE, null)).toHaveLength(1);
	});
});

describe('слияние по времени изменения', () => {
	it('более свежая версия побеждает', async () => {
		await repositories.food.upsertMany(ALICE, [food('a1', { calories: 420 })]);
		await repositories.food.upsertMany(ALICE, [
			food('a1', { calories: 500, updatedAt: '2026-01-15T10:00:00.000Z' })
		]);

		const [row] = await repositories.food.pullSince(ALICE, null);
		expect((row as unknown as { calories: number }).calories).toBe(500);
	});

	it('отставшая версия не откатывает свежую', async () => {
		await repositories.food.upsertMany(ALICE, [
			food('a1', { calories: 500, updatedAt: '2026-01-15T10:00:00.000Z' })
		]);

		const applied = await repositories.food.upsertMany(ALICE, [
			food('a1', { calories: 420, updatedAt: '2026-01-15T09:00:00.000Z' })
		]);

		const [row] = await repositories.food.pullSince(ALICE, null);
		expect((row as unknown as { calories: number }).calories).toBe(500);
		expect(applied).toBe(0);
	});

	it('одинаковое время изменения ничего не меняет', async () => {
		await repositories.food.upsertMany(ALICE, [food('a1', { calories: 420 })]);
		const applied = await repositories.food.upsertMany(ALICE, [food('a1', { calories: 999 })]);

		const [row] = await repositories.food.pullSince(ALICE, null);
		expect((row as unknown as { calories: number }).calories).toBe(420);
		expect(applied).toBe(0);
	});

	it('время создания не переписывается более поздней копией', async () => {
		await repositories.food.upsertMany(ALICE, [food('a1')]);
		await repositories.food.upsertMany(ALICE, [
			food('a1', { createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2026-01-15T10:00:00.000Z' })
		]);

		const [row] = await repositories.food.pullSince(ALICE, null);
		expect(row.createdAt).toBe('2026-01-15T08:00:00.000Z');
	});
});

describe('выборка по времени', () => {
	it('since отдаёт только изменённое позже', async () => {
		await repositories.food.upsertMany(ALICE, [
			food('old', { updatedAt: '2026-01-15T08:00:00.000Z' }),
			food('new', { updatedAt: '2026-01-15T12:00:00.000Z' })
		]);

		const changed = await repositories.food.pullSince(ALICE, '2026-01-15T10:00:00.000Z');
		expect(changed.map((row) => row.id)).toEqual(['new']);
	});

	it('без since отдаёт всё', async () => {
		await repositories.food.upsertMany(ALICE, [food('a1'), food('a2')]);
		expect(await repositories.food.pullSince(ALICE, null)).toHaveLength(2);
	});

	it('граница строгая: запись с тем же временем не повторяется', async () => {
		await repositories.food.upsertMany(ALICE, [food('a1')]);
		const changed = await repositories.food.pullSince(ALICE, '2026-01-15T08:00:00.000Z');
		expect(changed).toHaveLength(0);
	});
});

describe('надгробия', () => {
	it('удалённая запись приезжает с отметкой удаления, а не исчезает', async () => {
		await repositories.food.upsertMany(ALICE, [food('a1')]);
		await repositories.food.upsertMany(ALICE, [
			food('a1', { deletedAt: '2026-01-15T11:00:00.000Z', updatedAt: '2026-01-15T11:00:00.000Z' })
		]);

		const [row] = await repositories.food.pullSince(ALICE, null);

		// Без надгробия второе устройство не отличило бы удаление
		// от «этой записи тут ещё не было» и вернуло бы её обратно.
		expect(row.deletedAt).toBe('2026-01-15T11:00:00.000Z');
	});

	it('удаление не откатывается более старой живой копией', async () => {
		await repositories.food.upsertMany(ALICE, [
			food('a1', { deletedAt: '2026-01-15T11:00:00.000Z', updatedAt: '2026-01-15T11:00:00.000Z' })
		]);
		await repositories.food.upsertMany(ALICE, [
			food('a1', { deletedAt: null, updatedAt: '2026-01-15T09:00:00.000Z' })
		]);

		const [row] = await repositories.food.pullSince(ALICE, null);
		expect(row.deletedAt).toBe('2026-01-15T11:00:00.000Z');
	});
});

describe('состояние планировщика', () => {
	it('сохраняется и читается', async () => {
		await repositories.planner.save({
			userId: ALICE,
			schemaVersion: 2,
			settings: { calorieGoal: 1800 },
			updatedAt: '2026-01-15T08:00:00.000Z'
		});

		const state = await repositories.planner.get(ALICE);
		expect((state?.settings as { calorieGoal: number }).calorieGoal).toBe(1800);
	});

	it('более старая версия настроек не затирает свежую', async () => {
		await repositories.planner.save({
			userId: ALICE,
			schemaVersion: 2,
			settings: { calorieGoal: 1800 },
			updatedAt: '2026-01-15T12:00:00.000Z'
		});
		await repositories.planner.save({
			userId: ALICE,
			schemaVersion: 2,
			settings: { calorieGoal: 9999 },
			updatedAt: '2026-01-15T08:00:00.000Z'
		});

		const state = await repositories.planner.get(ALICE);
		expect((state?.settings as { calorieGoal: number }).calorieGoal).toBe(1800);
	});

	it('у пользователя без состояния возвращается null', async () => {
		expect(await repositories.planner.get(BOB)).toBeNull();
	});
});

describe('пустые пакеты', () => {
	it('не вызывают ошибок', async () => {
		expect(await repositories.food.upsertMany(ALICE, [])).toBe(0);
	});
});
