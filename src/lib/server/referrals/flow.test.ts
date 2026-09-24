import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { INIT_DATA_HEADER, requireUser } from '../auth/session';
import { getReadyDb, resetDbForTests } from '../db/client';
import { referrals, subscriptions } from '../db/schema';
import { signInitData } from '../telegram/initData';
import { settleReferral } from './notify';
import { getOrCreateReferralCode } from './referrals';

/**
 * Путь целиком: подписанная ссылка → вход → первая запись → дни Pro.
 *
 * Правила по отдельности проверены в referrals.test.ts. Здесь — что они
 * склеены там, где надо: приглашение пишется при самом первом входе,
 * а код берётся из подписанного start_param, а не из тела запроса.
 */

const TOKEN = '8585094426:TEST-TOKEN-NOT-REAL';

beforeAll(() => {
	process.env.DATABASE_URL = ':memory:';
	process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});

beforeEach(() => {
	// Каждому случаю — чистая база: иначе пользователи прошлых проверок
	// оказались бы «старыми» для следующих.
	resetDbForTests();
});

function request(telegramId: number, startParam?: string): Request {
	const fields: Record<string, string> = {
		auth_date: String(Math.floor(Date.now() / 1000)),
		user: JSON.stringify({ id: telegramId, first_name: 'Друг' })
	};
	if (startParam) fields.start_param = startParam;

	return new Request('http://localhost/api/auth/telegram', {
		method: 'POST',
		headers: { [INIT_DATA_HEADER]: signInitData(fields, TOKEN) }
	});
}

async function referralOf(inviteeId: string) {
	const db = await getReadyDb();
	const [row] = await db.select().from(referrals).where(eq(referrals.inviteeId, inviteeId));
	return row ?? null;
}

describe('приглашение от входа до награды', () => {
	it('новый пользователь по ссылке получает приглашение, а после записи — Pro', async () => {
		const { user: inviter } = await requireUser(request(100));
		const code = await getOrCreateReferralCode(await getReadyDb(), inviter.id);

		const { user: friend, repositories } = await requireUser(request(200, `ref_${code}`));
		expect((await referralOf(friend.id))?.status).toBe('pending');

		const stamp = new Date().toISOString();
		await repositories.habits.upsertMany(friend.id, [
			{
				id: 'habit-1',
				createdAt: stamp,
				updatedAt: stamp,
				deletedAt: null,
				name: 'Вода',
				icon: 'drop',
				frequency: 'daily',
				archived: false
			} as never
		]);

		const reward = await settleReferral(await getReadyDb(), friend.id);
		expect(reward?.inviterId).toBe(inviter.id);

		const db = await getReadyDb();
		const rows = await db.select().from(subscriptions);
		expect(rows.map((row) => row.userId).sort()).toEqual([friend.id, inviter.id].sort());
	});

	it('давний пользователь, открывший чужую ссылку, приглашённым не становится', async () => {
		const { user: inviter } = await requireUser(request(100));
		const code = await getOrCreateReferralCode(await getReadyDb(), inviter.id);

		const { user: old } = await requireUser(request(300));
		await requireUser(request(300, `ref_${code}`));

		expect(await referralOf(old.id)).toBeNull();
	});

	it('своя ссылка при первом входе невозможна, а при следующих не засчитывается', async () => {
		const { user } = await requireUser(request(400));
		const code = await getOrCreateReferralCode(await getReadyDb(), user.id);

		await requireUser(request(400, `ref_${code}`));

		expect(await referralOf(user.id)).toBeNull();
	});
});
