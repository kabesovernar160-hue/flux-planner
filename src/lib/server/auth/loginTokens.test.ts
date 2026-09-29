import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../db/client';
import { createRepositories } from '../db/repositories';
import { loginTokens } from '../db/schema';
import {
	consumeLoginToken,
	formatLoginCode,
	issueLoginToken,
	LOGIN_TOKEN_TTL_MS,
	loginUrl,
	normalizeLoginToken
} from './loginTokens';

/**
 * Коды входа из бота.
 *
 * Код — единственное, что отделяет чужой телефон от дневника, поэтому
 * здесь закрыты все четыре обещания: один обмен, десять минут, хеш
 * в базе и один живой код на человека.
 */

let db: Db;

beforeEach(async () => {
	db = await createTestDb();
});

async function makeUser(id: string, telegramId: string) {
	return createRepositories(db).users.upsertFromTelegram({
		id,
		telegramUserId: telegramId,
		firstName: 'Аня',
		now: '2026-09-01T08:00:00.000Z'
	});
}

describe('код входа', () => {
	it('обменивается на своего владельца', async () => {
		const user = await makeUser('u1', '111');
		const { token } = await issueLoginToken(db, user.id);

		const found = await consumeLoginToken(db, token);

		expect(found?.id).toBe(user.id);
	});

	it('срабатывает только один раз', async () => {
		const user = await makeUser('u1', '111');
		const { token } = await issueLoginToken(db, user.id);

		expect(await consumeLoginToken(db, token)).not.toBeNull();
		expect(await consumeLoginToken(db, token)).toBeNull();
	});

	it('два одновременных обмена не дают двух входов', async () => {
		const user = await makeUser('u1', '111');
		const { token } = await issueLoginToken(db, user.id);

		const results = await Promise.all([consumeLoginToken(db, token), consumeLoginToken(db, token)]);

		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it('протухает через десять минут', async () => {
		const user = await makeUser('u1', '111');
		const issuedAt = new Date('2026-09-29T10:00:00.000Z');
		const { token, expiresAt } = await issueLoginToken(db, user.id, issuedAt);

		expect(Date.parse(expiresAt) - issuedAt.getTime()).toBe(LOGIN_TOKEN_TTL_MS);

		const late = new Date(issuedAt.getTime() + LOGIN_TOKEN_TTL_MS + 1);
		expect(await consumeLoginToken(db, token, late)).toBeNull();

		const inTime = new Date(issuedAt.getTime() + LOGIN_TOKEN_TTL_MS - 1_000);
		expect((await consumeLoginToken(db, token, inTime))?.id).toBe(user.id);
	});

	it('в базе лежит хеш, а не сам код', async () => {
		const user = await makeUser('u1', '111');
		const { token } = await issueLoginToken(db, user.id);

		const rows = await db.select().from(loginTokens);

		expect(rows).toHaveLength(1);
		expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(rows)).not.toContain(token);
	});

	it('новый код гасит прежний неиспользованный', async () => {
		// Старое сообщение бота в чате не должно оставаться пропуском.
		const user = await makeUser('u1', '111');
		const first = await issueLoginToken(db, user.id);
		const second = await issueLoginToken(db, user.id);

		expect(await consumeLoginToken(db, first.token)).toBeNull();
		expect((await consumeLoginToken(db, second.token))?.id).toBe(user.id);
	});

	it('код одного человека не трогает код другого', async () => {
		const alice = await makeUser('u1', '111');
		const bob = await makeUser('u2', '222');
		const aliceCode = await issueLoginToken(db, alice.id);
		await issueLoginToken(db, bob.id);

		expect((await consumeLoginToken(db, aliceCode.token))?.id).toBe(alice.id);
	});

	it('выдуманный и испорченный код не проходят', async () => {
		const user = await makeUser('u1', '111');
		await issueLoginToken(db, user.id);

		expect(await consumeLoginToken(db, '')).toBeNull();
		expect(await consumeLoginToken(db, 'ABCDEFGHJK')).toBeNull();
		expect(await consumeLoginToken(db, 'x'.repeat(500))).toBeNull();
	});

	it('набранный руками код прощает регистр, пробелы и похожие буквы', async () => {
		const user = await makeUser('u1', '111');
		const { token, code } = await issueLoginToken(db, user.id);

		expect(code).toBe(formatLoginCode(token));
		expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);

		const typed = ` ${code.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')} `;
		expect((await consumeLoginToken(db, typed))?.id).toBe(user.id);
	});
});

describe('разбор кода', () => {
	it('приводит к одному виду', () => {
		expect(normalizeLoginToken('abcde-fghjk')).toBe('ABCDEFGHJK');
		expect(normalizeLoginToken('O0IL1 23456')).toBe('0011123456');
	});

	it('отвергает чужие символы и длину', () => {
		expect(normalizeLoginToken('ABCDEFGHJ')).toBeNull();
		expect(normalizeLoginToken('ABCDEFGHJKM')).toBeNull();
		expect(normalizeLoginToken('ABCDE+GHJK')).toBeNull();
		expect(normalizeLoginToken('ABCDEFGHJU')).toBeNull();
	});

	it('ссылка ведёт на страницу входа от корня приложения', () => {
		expect(loginUrl('https://flux.example.com/app', 'ABCDEFGHJK')).toBe(
			'https://flux.example.com/login?token=ABCDEFGHJK'
		);
	});
});
