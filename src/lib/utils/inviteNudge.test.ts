import { describe, expect, it } from 'vitest';
import { shouldShowInviteNudge } from './inviteNudge';

const NOW = new Date('2026-01-15T12:00:00.000Z');

describe('shouldShowInviteNudge', () => {
	it('показывается, если его ещё не закрывали', () => {
		expect(shouldShowInviteNudge(null, NOW, false)).toBe(true);
	});

	it('после закрытия молчит неделю', () => {
		expect(shouldShowInviteNudge('2026-01-10T12:00:00.000Z', NOW, false)).toBe(false);
		expect(shouldShowInviteNudge('2026-01-08T12:00:00.000Z', NOW, false)).toBe(true);
	});

	it('после лимита бонусных дней не показывается', () => {
		expect(shouldShowInviteNudge(null, NOW, true)).toBe(false);
	});

	it('испорченная отметка не прячет карточку навсегда', () => {
		expect(shouldShowInviteNudge('вчера', NOW, false)).toBe(true);
	});
});
