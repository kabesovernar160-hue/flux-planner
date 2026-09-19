import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '$lib/server/db/client';
import { createRepositories, type Repositories, type SyncRow } from '$lib/server/db/repositories';
import { buildDailySummary } from '$lib/server/notifications/notificationService';
import { signInitData, validateInitData } from '$lib/server/telegram/initData';
import { parsePushPayload, repositoryFor, SYNC_COLLECTIONS } from '$lib/server/sync/protocol';
import { createId } from '$lib/utils/id';

/**
 * Сквозной сценарий из брифа: подпись → пользователь → отправка изменений →
 * получение их на другом устройстве.
 *
 * HTTP-слой здесь не поднимается: эндпоинты — тонкая обёртка над этими же
 * вызовами, а тест без сети детерминирован и не зависит от порта.
 */

const TOKEN = '8585094426:TEST-TOKEN-NOT-REAL';
const DATE = '2026-01-15';
const NOW = new Date('2026-01-15T12:00:00.000Z');

let db: Db;
let repositories: Repositories;

beforeEach(async () => {
	db = await createTestDb();
	repositories = createRepositories(db);
});

/** Шаг 1–3: клиент Telegram подписал строку, сервер её проверил и завёл пользователя. */
async function authenticate(telegramId: number, firstName: string) {
	const initData = signInitData(
		{
			auth_date: String(Math.floor(NOW.getTime() / 1000)),
			user: JSON.stringify({ id: telegramId, first_name: firstName })
		},
		TOKEN
	);

	const validated = validateInitData(initData, TOKEN, { now: NOW });
	expect(validated.ok).toBe(true);
	if (!validated.ok) throw new Error('подпись не прошла');

	return repositories.users.upsertFromTelegram({
		id: createId(),
		telegramUserId: String(validated.data.user.id),
		firstName: validated.data.user.firstName,
		now: NOW.toISOString()
	});
}

/** Шаг 4: то, что делает POST /api/sync/push. */
async function push(userId: string, body: unknown) {
	const parsed = parsePushPayload(body);
	expect(parsed.ok).toBe(true);
	if (!parsed.ok) throw new Error(parsed.error);

	for (const collection of SYNC_COLLECTIONS) {
		const rows = parsed.payload[collection];
		if (rows?.length) {
			await repositoryFor(repositories, collection).upsertMany(userId, rows);
		}
	}
}

/** Шаг 5: то, что делает GET /api/sync/pull. */
async function pull(userId: string, since: string | null) {
	const changes: Record<string, SyncRow[]> = {};
	for (const collection of SYNC_COLLECTIONS) {
		changes[collection] = await repositoryFor(repositories, collection).pullSince(userId, since);
	}
	return changes;
}

const habit = (id: string, name: string, updatedAt = '2026-01-15T10:00:00.000Z') =>
	({
		id,
		createdAt: '2026-01-15T10:00:00.000Z',
		updatedAt,
		deletedAt: null,
		name,
		icon: 'barbell',
		frequency: 'daily',
		archived: false
	}) as unknown as SyncRow;

describe('сквозной сценарий синхронизации', () => {
	it('привычка, созданная на одном устройстве, приезжает на второе', async () => {
		const user = await authenticate(4242, 'Алиса');

		// Устройство A создало привычку и отправило её.
		await push(user.id, { changes: { habits: [habit('h1', 'Зарядка')] } });

		// Устройство B впервые синхронизируется — забирает всё.
		const first = await pull(user.id, null);
		expect(first.habits.map((row) => row.id)).toEqual(['h1']);

		// Устройство A переименовало привычку.
		await push(user.id, {
			changes: { habits: [habit('h1', 'Утренняя зарядка', '2026-01-15T11:00:00.000Z')] }
		});

		// Устройство B забирает только изменившееся.
		const second = await pull(user.id, '2026-01-15T10:30:00.000Z');
		expect(second.habits).toHaveLength(1);
		expect((second.habits[0] as unknown as { name: string }).name).toBe('Утренняя зарядка');
	});

	it('удаление доезжает надгробием, а не пропажей записи', async () => {
		const user = await authenticate(4242, 'Алиса');
		await push(user.id, { changes: { habits: [habit('h1', 'Зарядка')] } });

		await push(user.id, {
			changes: {
				habits: [
					{
						...habit('h1', 'Зарядка', '2026-01-15T11:00:00.000Z'),
						deletedAt: '2026-01-15T11:00:00.000Z'
					} as SyncRow
				]
			}
		});

		const changes = await pull(user.id, '2026-01-15T10:30:00.000Z');
		expect(changes.habits[0].deletedAt).toBe('2026-01-15T11:00:00.000Z');
	});

	it('данные двух пользователей не пересекаются', async () => {
		const alice = await authenticate(1111, 'Алиса');
		const bob = await authenticate(2222, 'Боб');

		await push(alice.id, { changes: { habits: [habit('h-alice', 'Зарядка')] } });
		await push(bob.id, { changes: { habits: [habit('h-bob', 'Пробежка')] } });

		expect((await pull(alice.id, null)).habits.map((r) => r.id)).toEqual(['h-alice']);
		expect((await pull(bob.id, null)).habits.map((r) => r.id)).toEqual(['h-bob']);
	});

	it('подменённый в теле запроса владелец игнорируется', async () => {
		const alice = await authenticate(1111, 'Алиса');
		const bob = await authenticate(2222, 'Боб');

		// Клиент Алисы пытается записать привычку в аккаунт Боба.
		const forged = { ...habit('h-forged', 'Чужая'), userId: bob.id } as SyncRow;
		await push(alice.id, { changes: { habits: [forged] } });

		expect(await pull(bob.id, null).then((c) => c.habits)).toHaveLength(0);
		expect(await pull(alice.id, null).then((c) => c.habits)).toHaveLength(1);
	});

	it('синхронизированные данные попадают в сводку для бота', async () => {
		const user = await authenticate(4242, 'Алиса');

		await push(user.id, {
			changes: {
				food: [
					{
						id: 'f1',
						createdAt: '2026-01-15T10:00:00.000Z',
						updatedAt: '2026-01-15T10:00:00.000Z',
						deletedAt: null,
						date: DATE,
						name: 'Овсянка',
						calories: 420,
						protein: 14,
						fat: 9,
						carbs: 68,
						source: 'manual'
					} as unknown as SyncRow
				]
			}
		});

		const summary = await buildDailySummary(db, user, DATE);

		expect(summary.hasData).toBe(true);
		expect(summary.text).toContain('Калории: 420');
	});

	it('строка с чужой подписью до базы не доходит', async () => {
		const forged = signInitData(
			{
				auth_date: String(Math.floor(NOW.getTime() / 1000)),
				user: JSON.stringify({ id: 9999, first_name: 'Взломщик' })
			},
			'подделанный-токен'
		);

		expect(validateInitData(forged, TOKEN, { now: NOW }).ok).toBe(false);
		expect(await repositories.users.listAll()).toHaveLength(0);
	});
});
