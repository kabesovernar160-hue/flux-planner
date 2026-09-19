import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../db/client';
import { createRepositories, type Repositories } from '../db/repositories';
import { loadDaySnapshot, loadPlannerSettings } from '../db/queries';
import { anonymousTelegramId, deleteAccountData } from './deleteAccount';

const DATE = '2026-01-15';
const stamps = { createdAt: '2026-01-15T08:00:00.000Z', updatedAt: '2026-01-15T08:00:00.000Z' };

let db: Db;
let repositories: Repositories;

beforeEach(async () => {
	db = await createTestDb();
	repositories = createRepositories(db);
});

async function makeUser(id: string, telegramId: string) {
	return repositories.users.upsertFromTelegram({
		id,
		telegramUserId: telegramId,
		firstName: 'Алиса',
		username: 'alice',
		now: stamps.createdAt
	});
}

async function fillDiary(userId: string) {
	await repositories.food.upsertMany(userId, [
		{
			id: `${userId}-food`,
			...stamps,
			date: DATE,
			name: 'Овсянка',
			calories: 320,
			protein: 12,
			fat: 6,
			carbs: 54,
			source: 'manual'
		} as never
	]);
	await repositories.weight.upsertMany(userId, [
		{ id: `${userId}-weight`, ...stamps, date: DATE, weightKg: 78.4 } as never
	]);
	await repositories.planner.save({
		userId,
		schemaVersion: 4,
		settings: { calorieGoal: 1700 },
		updatedAt: stamps.updatedAt
	});
}

describe('deleteAccountData', () => {
	it('стирает дневник целиком', async () => {
		const user = await makeUser('u1', '111');
		await fillDiary(user.id);

		await deleteAccountData(db, user.id);

		const snapshot = await loadDaySnapshot(db, user.id, DATE);
		expect(snapshot.foods).toHaveLength(0);
		expect(snapshot.weight).toBeNull();
		expect(await loadPlannerSettings(db, user.id)).toBeNull();
	});

	it('обезличивает учётную запись, а не удаляет её', async () => {
		// Строка платежа ссылается на пользователя и должна пережить удаление —
		// значит, сослаться ей должно быть на что.
		const user = await makeUser('u1', '111');
		await deleteAccountData(db, user.id);

		expect(await repositories.users.findByTelegramId('111')).toBeNull();

		const anonymous = await repositories.users.findByTelegramId(anonymousTelegramId(user.id));
		expect(anonymous?.firstName).toBeNull();
		expect(anonymous?.username).toBeNull();
	});

	it('вход тем же аккаунтом заводит нового пользователя', async () => {
		const user = await makeUser('u1', '111');
		await deleteAccountData(db, user.id);

		const fresh = await repositories.users.upsertFromTelegram({
			id: 'u2',
			telegramUserId: '111',
			firstName: 'Алиса',
			now: '2026-01-16T08:00:00.000Z'
		});

		expect(fresh.id).toBe('u2');
		expect((await loadDaySnapshot(db, fresh.id, DATE)).foods).toHaveLength(0);
	});

	it('чужие данные не трогает', async () => {
		const alice = await makeUser('u1', '111');
		const bob = await makeUser('u2', '222');
		await fillDiary(alice.id);
		await fillDiary(bob.id);

		await deleteAccountData(db, alice.id);

		expect((await loadDaySnapshot(db, bob.id, DATE)).foods).toHaveLength(1);
		expect((await loadDaySnapshot(db, bob.id, DATE)).weight?.weightKg).toBe(78.4);
	});
});
