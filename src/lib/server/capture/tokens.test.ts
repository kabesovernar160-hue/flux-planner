import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../db/client';
import { createRepositories, type Repositories } from '../db/repositories';
import { captureTokens } from '../db/schema';
import {
	findUserByCaptureToken,
	getCaptureTokenState,
	issueCaptureToken,
	revokeCaptureTokens
} from './tokens';

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
		now: '2026-01-15T08:00:00.000Z'
	});
}

describe('ключ быстрой записи', () => {
	it('выданный ключ опознаёт владельца', async () => {
		const user = await makeUser('u1', '111');
		const { token } = await issueCaptureToken(db, user.id);

		const found = await findUserByCaptureToken(db, token);

		expect(found?.id).toBe(user.id);
	});

	it('в базе лежит хеш, а не сам ключ', async () => {
		// Утёкшая копия базы не должна открывать доступ к чужим дневникам.
		const user = await makeUser('u1', '111');
		const { token } = await issueCaptureToken(db, user.id);

		const rows = await db.select().from(captureTokens);

		expect(rows).toHaveLength(1);
		expect(rows[0].tokenHash).not.toBe(token);
		expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('новый ключ отзывает прежний', async () => {
		// Два действующих ключа означают, что один человек не помнит.
		const user = await makeUser('u1', '111');
		const first = await issueCaptureToken(db, user.id);
		const second = await issueCaptureToken(db, user.id);

		expect(await findUserByCaptureToken(db, first.token)).toBeNull();
		expect((await findUserByCaptureToken(db, second.token))?.id).toBe(user.id);
	});

	it('отозванный ключ не работает', async () => {
		const user = await makeUser('u1', '111');
		const { token } = await issueCaptureToken(db, user.id);

		expect(await revokeCaptureTokens(db, user.id)).toBe(1);
		expect(await findUserByCaptureToken(db, token)).toBeNull();
	});

	it('чужой и мусорный ключ ничего не открывают', async () => {
		const alice = await makeUser('u1', '111');
		await makeUser('u2', '222');
		const { token } = await issueCaptureToken(db, alice.id);

		expect(await findUserByCaptureToken(db, 'не-ключ')).toBeNull();
		expect(await findUserByCaptureToken(db, '')).toBeNull();
		expect(await findUserByCaptureToken(db, `${token}x`)).toBeNull();
	});

	it('отмечает, когда ключом пользовались', async () => {
		// По этой отметке человек видит, работает ли команда на телефоне.
		const user = await makeUser('u1', '111');
		const { token } = await issueCaptureToken(db, user.id);

		expect((await getCaptureTokenState(db, user.id)).lastUsedAt).toBeNull();

		await findUserByCaptureToken(db, token);

		const state = await getCaptureTokenState(db, user.id);
		expect(state.exists).toBe(true);
		expect(state.lastUsedAt).not.toBeNull();
	});

	it('без ключа состояние пустое', async () => {
		const user = await makeUser('u1', '111');

		expect(await getCaptureTokenState(db, user.id)).toEqual({ exists: false });
	});

	it('ключи разных людей не пересекаются', async () => {
		const alice = await makeUser('u1', '111');
		const bob = await makeUser('u2', '222');

		const aliceToken = await issueCaptureToken(db, alice.id);
		const bobToken = await issueCaptureToken(db, bob.id);

		expect((await findUserByCaptureToken(db, aliceToken.token))?.id).toBe(alice.id);
		expect((await findUserByCaptureToken(db, bobToken.token))?.id).toBe(bob.id);

		await revokeCaptureTokens(db, alice.id);

		expect(await findUserByCaptureToken(db, aliceToken.token)).toBeNull();
		expect((await findUserByCaptureToken(db, bobToken.token))?.id).toBe(bob.id);
	});
});
