import { PLANS, type Entitlement, type PlanId, type PlanLimits } from '$lib/billing/plans';
import { telegram } from '$lib/telegram';
import { authHeaders } from '$lib/telegram/auth';

/**
 * Тариф и остаток квоты на клиенте.
 *
 * Здесь только отображение. Решение о доступе принимает сервер: он проверяет
 * подписку на каждом платном вызове, и правка этого состояния в браузере
 * ничего не открывает.
 */

export interface ScanQuota {
	limit: number;
	used: number;
	remaining: number;
	resetsAt: string;
}

export type BillingStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
export type PurchaseState = 'idle' | 'creating' | 'awaiting' | 'paid' | 'cancelled' | 'failed';

class BillingState {
	status = $state<BillingStatus>('idle');
	plan = $state<PlanId>('free');
	entitlementStatus = $state<Entitlement['status']>('none');
	expiresAt = $state<string | null>(null);
	limits = $state<PlanLimits>(PLANS.free.limits);
	scans = $state<ScanQuota | null>(null);

	purchase = $state<PurchaseState>('idle');
	error = $state<string | null>(null);

	get isPro(): boolean {
		return this.plan === 'pro';
	}

	/**
	 * На сколько дней назад открыта история. null — ограничения нет.
	 *
	 * null отвечается не только тем, у кого Pro, но и когда тариф неизвестен:
	 * вне Telegram, при недоступном сервере, до первого ответа. Ошибаться
	 * здесь можно только в одну сторону — показать человеку его же записи.
	 * Спрятать их из-за того, что мы не дозвонились до сервера, нельзя.
	 */
	get historyDays(): number | null {
		if (this.status !== 'ready' || this.plan !== 'free') return null;

		const days = this.limits.historyDays;
		return Number.isFinite(days) && days > 0 ? days : null;
	}

	/** Остались ли распознавания на сегодня. null — ещё не знаем. */
	get scansLeft(): number | null {
		return this.scans?.remaining ?? null;
	}

	/** Известно, что квота исчерпана. */
	get outOfScans(): boolean {
		return this.scans !== null && this.scans.remaining <= 0;
	}

	async refresh(): Promise<void> {
		if (!telegram.isEmbedded || !telegram.initData) {
			// Вне Telegram платных возможностей нет вовсе: сканер туда
			// и так не пускает, а показывать тариф не из чего.
			this.status = 'unavailable';
			return;
		}

		this.status = this.status === 'ready' ? 'ready' : 'loading';

		try {
			const response = await fetch('/api/billing/status', { headers: authHeaders() });
			if (!response.ok) {
				this.status = 'unavailable';
				return;
			}

			const payload = await response.json();

			this.plan = payload.plan === 'pro' ? 'pro' : 'free';
			this.entitlementStatus = payload.status;
			this.expiresAt = payload.expiresAt ?? null;
			this.limits = payload.limits ?? PLANS.free.limits;
			this.scans = payload.scans ?? null;
			this.status = 'ready';
		} catch {
			this.status = 'unavailable';
		}
	}

	/** Обновление остатка из ответа распознавания — без отдельного запроса. */
	applyQuota(quota: ScanQuota | undefined | null): void {
		if (quota) this.scans = quota;
	}

	/**
	 * Покупка подписки.
	 *
	 * Счёт выписывает сервер, окно оплаты показывает Telegram, деньги
	 * приходят через Stars. Приложение узнаёт об успехе дважды: сразу
	 * из ответа окна и надёжно — из вебхука, поэтому статус после оплаты
	 * перечитывается с сервера.
	 */
	async subscribe(): Promise<void> {
		if (this.purchase === 'creating' || this.purchase === 'awaiting') return;

		this.error = null;
		this.purchase = 'creating';

		try {
			const response = await fetch('/api/billing/invoice', {
				method: 'POST',
				headers: authHeaders()
			});

			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				this.error = payload?.error?.message ?? 'Не удалось создать счёт';
				this.purchase = 'failed';
				return;
			}

			const { link } = (await response.json()) as { link: string };

			this.purchase = 'awaiting';
			const result = await telegram.openInvoice(link);

			if (result === 'paid') {
				telegram.haptic.notification('success');
				this.purchase = 'paid';

				// Вебхук мог ещё не доехать, поэтому статус перечитывается
				// с небольшой задержкой — иначе экран покажет старый тариф.
				await new Promise((resolve) => setTimeout(resolve, 1200));
				await this.refresh();
				return;
			}

			if (result === 'cancelled') {
				this.purchase = 'cancelled';
				return;
			}

			if (result === 'unsupported') {
				this.error = 'Оплата звёздами доступна в приложении Telegram';
				this.purchase = 'failed';
				return;
			}

			this.error = 'Оплата не прошла. Попробуйте ещё раз';
			this.purchase = 'failed';
		} catch {
			this.error = 'Нет связи с сервером';
			this.purchase = 'failed';
		}
	}
}

export const billing = new BillingState();
