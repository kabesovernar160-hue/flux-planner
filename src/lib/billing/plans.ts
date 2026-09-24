/**
 * Тарифы и лимиты.
 *
 * Модуль общий для сервера и клиента: сервер по нему решает, пускать ли
 * запрос, клиент — что показать в интерфейсе. Две копии правил разъехались бы
 * на первом же изменении цены, и человек видел бы одно, а получал другое.
 *
 * Здесь только описание тарифов. Ни денег, ни платежей: всё, что связано
 * с Telegram Stars, живёт на сервере.
 */

export type PlanId = 'free' | 'pro';

export interface PlanLimits {
	/** Сколько распознаваний по фото в сутки. Каждое стоит денег провайдеру. */
	scansPerDay: number;
	/** Сколько дней истории показывает аналитика. */
	historyDays: number;
	/** Итоги дня в чате с ботом. */
	dailySummary: boolean;
	/** Выгрузка данных. */
	dataExport: boolean;
}

export interface Plan {
	id: PlanId;
	title: string;
	/** Цена в звёздах Telegram за 30 дней. Ноль — бесплатно. */
	stars: number;
	limits: PlanLimits;
	/** Что человек получает. Текст показывается на экране подписки. */
	perks: string[];
}

/**
 * Бесплатный тариф намеренно рабочий, а не демонстрационный.
 *
 * Дневник, привычки, финансы, поиск по справочнику и ручной ввод доступны
 * полностью: приложение должно быть полезным до оплаты. Платится только то,
 * что стоит денег нам — распознавание по фотографии, — и глубина истории.
 */
export const PLANS: Record<PlanId, Plan> = {
	free: {
		id: 'free',
		title: 'Бесплатно',
		stars: 0,
		limits: {
			scansPerDay: 3,
			historyDays: 30,
			dailySummary: true,
			dataExport: true
		},
		perks: [
			'Дневник питания, привычки и финансы без ограничений',
			'Поиск по справочнику продуктов и ручной ввод',
			'3 распознавания по фото в день',
			'История и аналитика за 30 дней'
		]
	},
	pro: {
		id: 'pro',
		title: 'Pro',
		stars: 100,
		limits: {
			// Не «безлимит»: обещать безграничное распознавание нельзя,
			// потому что каждый вызов стоит денег, а честный потолок
			// защищает и нас, и пользователя от случайного зацикливания.
			scansPerDay: 50,
			historyDays: 3650,
			dailySummary: true,
			dataExport: true
		},
		perks: [
			'50 распознаваний по фото в день',
			'Вся история и аналитика без ограничения по дням',
			'Поддержка разработки приложения'
		]
	}
};

/** Длительность оплаченного периода. Telegram Stars поддерживает ровно 30 дней. */
export const SUBSCRIPTION_DAYS = 30;
export const SUBSCRIPTION_PERIOD_SECONDS = SUBSCRIPTION_DAYS * 24 * 60 * 60;

export type SubscriptionStatus = 'none' | 'active' | 'expired' | 'refunded' | 'cancelled';

export interface Entitlement {
	plan: PlanId;
	status: SubscriptionStatus;
	limits: PlanLimits;
	/** Конец оплаченного периода, ISO. У бесплатного тарифа пусто. */
	expiresAt: string | null;
}

export interface StoredSubscription {
	plan: string;
	status: string;
	expiresAt: string | null;
}

/**
 * Что доступно пользователю прямо сейчас.
 *
 * Срок проверяется по времени, а не по статусу в базе: платёж мог пройти
 * месяц назад, и строка «active» сама по себе ничего не значит. Единственный
 * надёжный признак — не истёк ли оплаченный период.
 */
export function resolveEntitlement(
	subscription: StoredSubscription | null,
	now: Date = new Date()
): Entitlement {
	const free: Entitlement = {
		plan: 'free',
		status: 'none',
		limits: PLANS.free.limits,
		expiresAt: null
	};

	if (!subscription) return free;

	const plan = subscription.plan === 'pro' ? 'pro' : 'free';
	if (plan === 'free') return free;

	if (subscription.status === 'refunded' || subscription.status === 'cancelled') {
		return { ...free, status: subscription.status };
	}

	const expiresAt = subscription.expiresAt;
	const expired = !expiresAt || new Date(expiresAt).getTime() <= now.getTime();

	if (expired) {
		return { ...free, status: 'expired', expiresAt: expiresAt ?? null };
	}

	return {
		plan: 'pro',
		status: 'active',
		limits: PLANS.pro.limits,
		expiresAt
	};
}

/** Конец периода после оплаты. Продление считается от большей из двух дат. */
export function calculateExpiry(current: string | null, now: Date = new Date()): string {
	return extendExpiry(current, SUBSCRIPTION_DAYS, now);
}

/**
 * Срок, продлённый на несколько дней.
 *
 * Общий для оплаты и подарков: дни всегда прибавляются к большей из двух
 * дат — концу текущего периода или сегодняшнему дню. Продление не «сгорает»:
 * если человек оплатил заранее или получил дни за приглашение, оставшиеся
 * дни прибавляются, а не теряются.
 */
export function extendExpiry(current: string | null, days: number, now: Date = new Date()): string {
	const base =
		current && new Date(current).getTime() > now.getTime() ? new Date(current) : new Date(now);

	return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
