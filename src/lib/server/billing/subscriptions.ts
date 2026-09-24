import { eq } from 'drizzle-orm';
import {
	calculateExpiry,
	extendExpiry,
	PLANS,
	resolveEntitlement,
	type Entitlement,
	type PlanId
} from '$lib/billing/plans';
import { createId } from '$lib/utils/id';
import { nowIso } from '$lib/utils/date';
import type { Db, DbExecutor } from '../db/client';
import { payments, subscriptions } from '../db/schema';

/**
 * Подписки и платежи.
 *
 * Правило одно: доступ определяется записью в базе, а не тем, что сообщил
 * клиент. Приложение может сколько угодно считать себя «про» — сервер
 * смотрит только сюда.
 */

export async function getEntitlement(
	db: Db,
	userId: string,
	now: Date = new Date()
): Promise<Entitlement> {
	const [row] = await db
		.select()
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.limit(1);

	return resolveEntitlement(
		row ? { plan: row.plan, status: row.status, expiresAt: row.expiresAt } : null,
		now
	);
}

/**
 * Строка подписки как она есть.
 *
 * getEntitlement отвечает на вопрос «что человеку доступно», а здесь нужен
 * идентификатор платежа: без него нечего отменять.
 */
export async function getSubscriptionRow(db: Db, userId: string) {
	const [row] = await db
		.select()
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.limit(1);

	return row ?? null;
}

export interface ActivationInput {
	userId: string;
	plan: PlanId;
	chargeId: string;
	stars: number;
	payload: string;
	/** Срок из ответа Telegram, если он его прислал. */
	expiresAt?: string | null;
	subscriptionId?: string | null;
	now?: Date;
}

export interface ActivationResult {
	/** false — платёж уже был учтён, повторное начисление не произошло. */
	applied: boolean;
	expiresAt: string;
}

/**
 * Начисление оплаченного периода.
 *
 * Идемпотентно по chargeId: Telegram может доставить одно обновление дважды,
 * и второй раз продлевать подписку нельзя — это прямой убыток пользователю
 * в доверии и нам в поддержке.
 */
export async function activateSubscription(
	db: Db,
	input: ActivationInput
): Promise<ActivationResult> {
	const now = input.now ?? new Date();
	const timestamp = now.toISOString();

	const [existingPayment] = await db
		.select({ id: payments.id })
		.from(payments)
		.where(eq(payments.chargeId, input.chargeId))
		.limit(1);

	const [current] = await db
		.select()
		.from(subscriptions)
		.where(eq(subscriptions.userId, input.userId))
		.limit(1);

	if (existingPayment) {
		return { applied: false, expiresAt: current?.expiresAt ?? timestamp };
	}

	// Срок из Telegram точнее нашего расчёта: там он привязан к списанию.
	// Но он ничего не знает о подаренных днях — за приглашения, например, —
	// и при автопродлении перезаписал бы их. Поэтому берётся больший из двух:
	// наш расчёт продлевает от текущего конца, вместе с подарком.
	const calculated = calculateExpiry(current?.expiresAt ?? null, now);
	const expiresAt = input.expiresAt && input.expiresAt > calculated ? input.expiresAt : calculated;

	await db.insert(payments).values({
		id: createId(),
		userId: input.userId,
		chargeId: input.chargeId,
		stars: input.stars,
		payload: input.payload,
		status: 'paid',
		createdAt: timestamp
	});

	await db
		.insert(subscriptions)
		.values({
			userId: input.userId,
			plan: input.plan,
			status: 'active',
			expiresAt,
			chargeId: input.chargeId,
			subscriptionId: input.subscriptionId ?? null,
			createdAt: timestamp,
			updatedAt: timestamp
		})
		.onConflictDoUpdate({
			target: subscriptions.userId,
			set: {
				plan: input.plan,
				status: 'active',
				expiresAt,
				chargeId: input.chargeId,
				subscriptionId: input.subscriptionId ?? current?.subscriptionId ?? null,
				updatedAt: timestamp
			}
		});

	return { applied: true, expiresAt };
}

/**
 * Подарить дни Pro.
 *
 * Не платёж: в журнал платежей ничего не пишется. Дни прибавляются к концу
 * текущего срока, поэтому оплаченный период не сокращается и не ломается —
 * платная подписка просто заканчивается позже.
 *
 * Строка после возврата или ручного снятия Pro оживает заново, но без
 * идентификаторов прежнего платежа: иначе «отмена» в чате попыталась бы
 * отменить подписку, которой больше нет.
 *
 * Принимает и открытую транзакцию: начисление за приглашение обязано
 * пройти вместе с отметкой о нём или не пройти вовсе.
 */
export async function grantProDays(
	db: DbExecutor,
	userId: string,
	days: number,
	now: Date = new Date()
): Promise<string> {
	const timestamp = now.toISOString();

	const [current] = await db
		.select()
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.limit(1);

	const alive = current?.plan === 'pro' && current.status === 'active';
	const expiresAt = extendExpiry(alive ? current.expiresAt : null, days, now);

	await db
		.insert(subscriptions)
		.values({
			userId,
			plan: 'pro',
			status: 'active',
			expiresAt,
			chargeId: null,
			subscriptionId: null,
			createdAt: timestamp,
			updatedAt: timestamp
		})
		.onConflictDoUpdate({
			target: subscriptions.userId,
			set: {
				plan: 'pro',
				status: 'active',
				expiresAt,
				chargeId: alive ? current.chargeId : null,
				subscriptionId: alive ? current.subscriptionId : null,
				updatedAt: timestamp
			}
		});

	return expiresAt;
}

/**
 * Возврат платежа.
 *
 * Доступ снимается сразу: держать оплаченные возможности после возврата денег
 * — это ошибка не в пользу пользователя, а в ущерб продукту.
 */
export async function revokeSubscription(
	db: Db,
	chargeId: string,
	status: 'refunded' | 'cancelled' = 'refunded'
): Promise<boolean> {
	const timestamp = nowIso();

	const [payment] = await db
		.select()
		.from(payments)
		.where(eq(payments.chargeId, chargeId))
		.limit(1);

	if (!payment) return false;

	await db.update(payments).set({ status }).where(eq(payments.chargeId, chargeId));

	await db
		.update(subscriptions)
		.set({ status, expiresAt: timestamp, updatedAt: timestamp })
		.where(eq(subscriptions.userId, payment.userId));

	return true;
}

/** История платежей пользователя: для экрана подписки и разбора вопросов. */
export async function listPayments(db: Db, userId: string) {
	return db.select().from(payments).where(eq(payments.userId, userId));
}

export { PLANS };
