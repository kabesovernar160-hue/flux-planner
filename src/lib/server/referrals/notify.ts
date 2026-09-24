import { env } from '$env/dynamic/private';
import { REFERRAL_CAP_DAYS } from '$lib/billing/referral';
import { pluralDays } from '$lib/utils/format';
import type { Db } from '../db/client';
import { logServerError } from '../errors';
import { sendMessage } from '../telegram/botApi';
import { findTelegramId, qualifyReferral, type QualifiedReferral } from './referrals';

/**
 * Сообщение пригласившему.
 *
 * Отдельно от отправки, чтобы текст проверялся тестом без сети. Лимит
 * называется прямо: иначе после девяностого дня человек решит, что
 * программа сломалась, и продолжит звать друзей ради дней, которых не будет.
 */
export function inviterRewardText(result: QualifiedReferral): string {
	const { inviterDays, inviterEarnedDays, inviterExpiresAt } = result;

	if (inviterDays === 0) {
		return (
			`Друг присоединился по вашей ссылке. Бонусные дни за приглашения уже набраны — ` +
			`${REFERRAL_CAP_DAYS} из ${REFERRAL_CAP_DAYS}. Спасибо, что зовёте друзей.`
		);
	}

	const lines = [`Друг присоединился — +${inviterDays} ${pluralDays(inviterDays)} Pro`];

	if (inviterExpiresAt) {
		const until = new Date(inviterExpiresAt).toLocaleDateString('ru-RU', {
			day: 'numeric',
			month: 'long'
		});
		lines.push(`Pro действует до ${until}.`);
	}

	if (inviterEarnedDays >= REFERRAL_CAP_DAYS) {
		lines.push(
			`Это последние бонусные дни: за приглашения можно получить до ${REFERRAL_CAP_DAYS}.`
		);
	}

	return lines.join('\n');
}

type Send = (chatId: string, text: string) => Promise<void>;

/**
 * Отправка в чат с ботом.
 *
 * Без токена бота (локальная разработка) сообщение пишется в журнал:
 * отправлять его некуда, а видеть, что оно было бы отправлено, полезно.
 * Ошибка отправки не поднимается наверх: дни уже начислены, и то, что
 * человек закрыл чат с ботом, не должно откатывать награду.
 */
export async function notifyInviter(
	db: Db,
	result: QualifiedReferral,
	options: { send?: Send; botToken?: string } = {}
): Promise<void> {
	const telegramId = await findTelegramId(db, result.inviterId);
	if (!telegramId) return;

	const text = inviterRewardText(result);
	const botToken = options.botToken ?? env.TELEGRAM_BOT_TOKEN?.trim();

	if (!botToken && !options.send) {
		console.info(`[referrals] сообщение для ${telegramId} (нет токена бота):\n${text}`);
		return;
	}

	try {
		await (options.send ?? ((chatId, message) => sendMessage(chatId, message)))(telegramId, text);
	} catch (error) {
		logServerError('referrals/notify', error);
	}
}

/**
 * Проверить приглашение после записи и сообщить о награде.
 *
 * Вызывается из всех мест, где сервер принимает записи. Никогда не бросает:
 * засчитывание — побочный эффект, и его сбой не должен ронять синхронизацию
 * или ответ бота. Неудачная попытка повторится на следующей записи — пока
 * приглашение не засчитано, оно остаётся в ожидании.
 */
export async function settleReferral(db: Db, inviteeId: string): Promise<QualifiedReferral | null> {
	try {
		const result = await qualifyReferral(db, inviteeId);
		if (result) await notifyInviter(db, result);
		return result;
	} catch (error) {
		logServerError('referrals/settle', error);
		return null;
	}
}
