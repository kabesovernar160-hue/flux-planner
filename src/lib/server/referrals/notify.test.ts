import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type Db } from '../db/client';
import { users } from '../db/schema';
import { inviterRewardText, notifyInviter } from './notify';
import type { QualifiedReferral } from './referrals';

const result = (overrides: Partial<QualifiedReferral> = {}): QualifiedReferral => ({
	referralId: 'r1',
	inviterId: 'inviter',
	inviteeId: 'invitee',
	inviterDays: 7,
	inviteeDays: 7,
	inviterEarnedDays: 7,
	inviteeExpiresAt: '2026-01-22T12:00:00.000Z',
	inviterExpiresAt: '2026-01-22T12:00:00.000Z',
	...overrides
});

let db: Db;

beforeEach(async () => {
	db = await createTestDb();
	await db.insert(users).values({
		id: 'inviter',
		telegramUserId: '555',
		username: null,
		firstName: null,
		timezone: 'UTC',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	});
});

describe('сообщение пригласившему', () => {
	it('обычная награда', () => {
		const text = inviterRewardText(result());

		expect(text).toContain('Друг присоединился — +7 дней Pro');
		expect(text).toContain('Pro действует до 22 января');
	});

	it('последние дни до лимита названы прямо', () => {
		const text = inviterRewardText(result({ inviterDays: 6, inviterEarnedDays: 90 }));

		expect(text).toContain('+6 дней Pro');
		expect(text).toContain('до 90');
	});

	it('после лимита — без обещания дней', () => {
		const text = inviterRewardText(
			result({ inviterDays: 0, inviterEarnedDays: 90, inviterExpiresAt: null })
		);

		expect(text).not.toContain('+');
		expect(text).toContain('90 из 90');
	});

	it('уходит в чат пригласившего', async () => {
		const send = vi.fn(async () => {});

		await notifyInviter(db, result(), { send });

		expect(send).toHaveBeenCalledWith('555', expect.stringContaining('+7 дней Pro'));
	});

	it('без токена бота только пишется в журнал', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});

		await notifyInviter(db, result(), { botToken: '' });

		expect(info).toHaveBeenCalledWith(expect.stringContaining('+7 дней Pro'));
		info.mockRestore();
	});

	it('сбой отправки не отменяет награду и не поднимается наверх', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const send = vi.fn(async () => {
			throw new Error('bot was blocked by the user');
		});

		await expect(notifyInviter(db, result(), { send })).resolves.toBeUndefined();
		error.mockRestore();
	});
});
