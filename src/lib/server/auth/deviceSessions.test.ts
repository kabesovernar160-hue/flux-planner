import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../db/client';
import { createRepositories } from '../db/repositories';
import { deviceSessions } from '../db/schema';
import {
	createDeviceSession,
	deviceLabel,
	listDeviceSessions,
	parseDeviceCookie,
	PREVIOUS_SECRET_GRACE_MS,
	readCookie,
	revokeAllDeviceSessions,
	revokeDeviceSession,
	ROTATE_AFTER_MS,
	rotateDeviceSession,
	SESSION_TTL_MS,
	validateDeviceSession
} from './deviceSessions';

/**
 * Сессии устройств: проверка, ротация, отзыв.
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

const IPHONE_SAFARI =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

describe('сессия устройства', () => {
	it('кука опознаёт владельца', async () => {
		const user = await makeUser('u1', '111');
		const { cookie } = await createDeviceSession(db, user.id, { userAgent: IPHONE_SAFARI });

		const valid = await validateDeviceSession(db, cookie);

		expect(valid?.user.id).toBe(user.id);
		expect(valid?.session.label).toBe('iPhone · Safari');
		expect(valid?.needsRotation).toBe(false);
	});

	it('в базе лежит хеш секрета, а не сам секрет', async () => {
		const user = await makeUser('u1', '111');
		const { cookie } = await createDeviceSession(db, user.id);
		const secret = parseDeviceCookie(cookie)!.secret;

		const rows = await db.select().from(deviceSessions);

		expect(rows[0].secretHash).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(rows)).not.toContain(secret);
	});

	it('подобранный секрет к чужому идентификатору не подходит', async () => {
		const user = await makeUser('u1', '111');
		const { session } = await createDeviceSession(db, user.id);

		expect(await validateDeviceSession(db, `${session.id}.${'A'.repeat(43)}`)).toBeNull();
		expect(await validateDeviceSession(db, 'мусор')).toBeNull();
		expect(await validateDeviceSession(db, '')).toBeNull();
	});

	it('отозванная сессия не пускает', async () => {
		const user = await makeUser('u1', '111');
		const { cookie, session } = await createDeviceSession(db, user.id);

		expect(await revokeDeviceSession(db, user.id, session.id)).toBe(true);
		expect(await validateDeviceSession(db, cookie)).toBeNull();
	});

	it('чужую сессию отозвать нельзя', async () => {
		const alice = await makeUser('u1', '111');
		const bob = await makeUser('u2', '222');
		const { cookie, session } = await createDeviceSession(db, alice.id);

		expect(await revokeDeviceSession(db, bob.id, session.id)).toBe(false);
		expect(await validateDeviceSession(db, cookie)).not.toBeNull();
	});

	it('«выйти везде» отзывает все устройства человека и только его', async () => {
		const alice = await makeUser('u1', '111');
		const bob = await makeUser('u2', '222');
		const phone = await createDeviceSession(db, alice.id);
		const tablet = await createDeviceSession(db, alice.id);
		const bobPhone = await createDeviceSession(db, bob.id);

		expect(await revokeAllDeviceSessions(db, alice.id)).toBe(2);

		expect(await validateDeviceSession(db, phone.cookie)).toBeNull();
		expect(await validateDeviceSession(db, tablet.cookie)).toBeNull();
		expect(await validateDeviceSession(db, bobPhone.cookie)).not.toBeNull();
	});

	it('истекает через 90 дней без ротации', async () => {
		const user = await makeUser('u1', '111');
		const created = new Date('2026-01-01T00:00:00.000Z');
		const { cookie } = await createDeviceSession(db, user.id, { now: created });

		const late = new Date(created.getTime() + SESSION_TTL_MS + 1);
		expect(await validateDeviceSession(db, cookie, late)).toBeNull();
	});

	it('через неделю просит ротацию', async () => {
		const user = await makeUser('u1', '111');
		const created = new Date('2026-01-01T00:00:00.000Z');
		const { cookie } = await createDeviceSession(db, user.id, { now: created });

		const later = new Date(created.getTime() + ROTATE_AFTER_MS + 1);
		expect((await validateDeviceSession(db, cookie, later))?.needsRotation).toBe(true);
	});

	it('после ротации новая кука работает, старая — только несколько минут', async () => {
		const user = await makeUser('u1', '111');
		const created = new Date('2026-01-01T00:00:00.000Z');
		const { cookie, session } = await createDeviceSession(db, user.id, { now: created });

		const rotatedAt = new Date(created.getTime() + ROTATE_AFTER_MS + 1);
		const fresh = await rotateDeviceSession(db, session, rotatedAt);
		expect(fresh).not.toBeNull();
		expect(fresh).not.toBe(cookie);

		const soon = new Date(rotatedAt.getTime() + 1_000);
		expect((await validateDeviceSession(db, fresh!, soon))?.user.id).toBe(user.id);
		expect((await validateDeviceSession(db, cookie, soon))?.needsRotation).toBe(false);

		const afterGrace = new Date(rotatedAt.getTime() + PREVIOUS_SECRET_GRACE_MS + 1);
		expect(await validateDeviceSession(db, cookie, afterGrace)).toBeNull();
		expect(await validateDeviceSession(db, fresh!, afterGrace)).not.toBeNull();
	});

	it('из двух одновременных ротаций срабатывает одна', async () => {
		const user = await makeUser('u1', '111');
		const { session } = await createDeviceSession(db, user.id);

		const [first, second] = await Promise.all([
			rotateDeviceSession(db, session),
			rotateDeviceSession(db, session)
		]);

		expect([first, second].filter(Boolean)).toHaveLength(1);
	});

	it('ротация продлевает срок', async () => {
		const user = await makeUser('u1', '111');
		const created = new Date('2026-01-01T00:00:00.000Z');
		const { session } = await createDeviceSession(db, user.id, { now: created });

		const rotatedAt = new Date(created.getTime() + 80 * 24 * 60 * 60 * 1000);
		const fresh = await rotateDeviceSession(db, session, rotatedAt);

		const beyondFirstTerm = new Date(created.getTime() + SESSION_TTL_MS + 1);
		expect(await validateDeviceSession(db, fresh!, beyondFirstTerm)).not.toBeNull();
	});

	it('список — только действующие сессии своего человека, без хешей', async () => {
		const alice = await makeUser('u1', '111');
		const bob = await makeUser('u2', '222');
		await createDeviceSession(db, alice.id, { userAgent: IPHONE_SAFARI });
		const old = await createDeviceSession(db, alice.id, { userAgent: ANDROID_CHROME });
		await createDeviceSession(db, bob.id);
		await revokeDeviceSession(db, alice.id, old.session.id);

		const list = await listDeviceSessions(db, alice.id);

		expect(list).toHaveLength(1);
		expect(list[0].label).toBe('iPhone · Safari');
		expect(Object.keys(list[0])).not.toContain('secretHash');
	});
});

describe('вспомогательное', () => {
	it('подпись устройства узнаётся по user-agent', () => {
		expect(deviceLabel(IPHONE_SAFARI)).toBe('iPhone · Safari');
		expect(deviceLabel(ANDROID_CHROME)).toBe('Android · Chrome');
		expect(deviceLabel(null)).toBe('Браузер');
	});

	it('кука читается из заголовка среди прочих', () => {
		expect(readCookie('a=1; fx_session=abc.def; b=2', 'fx_session')).toBe('abc.def');
		expect(readCookie('a=1', 'fx_session')).toBeNull();
		expect(readCookie(null, 'fx_session')).toBeNull();
	});
});
