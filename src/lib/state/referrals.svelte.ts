import { REFERRAL_CAP_DAYS, REFERRAL_REWARD_DAYS } from '$lib/billing/referral';
import { telegram } from '$lib/telegram';
import { authHeaders } from '$lib/telegram/auth';

export type ReferralStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/**
 * Приглашение друзей на клиенте.
 *
 * Только отображение: код, ссылку и счётчик выдаёт сервер, и засчитывает
 * приглашения тоже он. Отсюда нельзя ни начислить дни, ни сменить код.
 */
class ReferralState {
	status = $state<ReferralStatus>('idle');
	link = $state<string | null>(null);
	/** Засчитанные друзья. */
	invited = $state(0);
	/** Пришли по ссылке, но ещё ничего не записали. */
	pending = $state(0);
	earnedDays = $state(0);
	rewardDays = $state(REFERRAL_REWARD_DAYS);
	capDays = $state(REFERRAL_CAP_DAYS);

	/** Лимит бонусных дней выбран: звать дальше можно, но дней не будет. */
	get capReached(): boolean {
		return this.earnedDays >= this.capDays;
	}

	#inFlight: Promise<void> | null = null;

	/** Повторный вызов во время запроса присоединяется к нему. */
	refresh(): Promise<void> {
		this.#inFlight ??= this.#load().finally(() => {
			this.#inFlight = null;
		});
		return this.#inFlight;
	}

	async #load(): Promise<void> {
		if (!telegram.isEmbedded || !telegram.initData) {
			// Ссылка привязана к аккаунту Telegram: вне его выдавать её некому.
			this.status = 'unavailable';
			return;
		}

		this.status = this.status === 'ready' ? 'ready' : 'loading';

		try {
			const response = await fetch('/api/referrals', { headers: authHeaders() });
			if (!response.ok) {
				this.status = 'unavailable';
				return;
			}

			const payload = await response.json();
			this.link = typeof payload.link === 'string' ? payload.link : null;
			this.invited = Number(payload.invited) || 0;
			this.pending = Number(payload.pending) || 0;
			this.earnedDays = Number(payload.earnedDays) || 0;
			this.rewardDays = Number(payload.rewardDays) || REFERRAL_REWARD_DAYS;
			this.capDays = Number(payload.capDays) || REFERRAL_CAP_DAYS;
			this.status = this.link ? 'ready' : 'unavailable';
		} catch {
			this.status = 'unavailable';
		}
	}
}

export const referral = new ReferralState();
