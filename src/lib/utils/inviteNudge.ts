/**
 * Когда показывать приглашение на экране аналитики.
 *
 * Раз в неделю, а не при каждом открытии: аналитику смотрят часто,
 * и карточка, которую закрываешь каждый день, превращается в рекламу.
 * После лимита бонусных дней не показывается вовсе — звать дальше
 * можно из настроек, но обещать с экрана то, чего не будет, нельзя.
 */

export const INVITE_NUDGE_INTERVAL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldShowInviteNudge(
	dismissedAt: string | null,
	now: Date,
	capReached: boolean
): boolean {
	if (capReached) return false;
	if (!dismissedAt) return true;

	const last = new Date(dismissedAt).getTime();
	// Испорченная отметка не должна прятать карточку навсегда.
	if (!Number.isFinite(last)) return true;

	return now.getTime() - last >= INVITE_NUDGE_INTERVAL_DAYS * DAY_MS;
}
