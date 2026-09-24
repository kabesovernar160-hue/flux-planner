/**
 * Правила реферальной программы.
 *
 * Модуль общий для сервера и клиента, как и тарифы: сервер по нему начисляет
 * дни, клиент — объясняет условия. Две копии чисел разъехались бы, и экран
 * обещал бы одно, а начислялось бы другое.
 */

/** Сколько дней Pro получает каждая сторона за засчитанное приглашение. */
export const REFERRAL_REWARD_DAYS = 7;

/**
 * Потолок для пригласившего — сумма дней за все приглашения.
 *
 * Без него приглашения превращаются в бесплатный Pro навсегда для тех, у кого
 * большой чат. Приглашённый потолком не ограничен: его награда разовая.
 */
export const REFERRAL_CAP_DAYS = 90;

/** Префикс параметра запуска: t.me/<бот>/app?startapp=ref_<код>. */
export const REFERRAL_START_PREFIX = 'ref_';

/**
 * Алфавит кода: строчные латинские буквы и цифры без похожих друг на друга
 * (0/o, 1/l/i). Код иногда диктуют голосом или перепечатывают со скриншота.
 */
export const REFERRAL_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const REFERRAL_CODE_LENGTH = 8;

const CODE_PATTERN = new RegExp(
	`^${REFERRAL_START_PREFIX}([${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}})$`
);

/**
 * Код из параметра запуска.
 *
 * Всё, что не похоже на реферальный код, отбрасывается ещё до базы:
 * параметр приходит из ссылки, и в нём может оказаться что угодно.
 */
export function parseReferralStartParam(param: string | null | undefined): string | null {
	if (!param) return null;
	return CODE_PATTERN.exec(param)?.[1] ?? null;
}

/** Ссылка-приглашение. Открывает Mini App сразу, минуя чат с ботом. */
export function referralLink(code: string, botUsername: string): string {
	return `https://t.me/${botUsername}/app?startapp=${REFERRAL_START_PREFIX}${code}`;
}

/** Текст, с которым ссылка уходит в чат через «Поделиться». */
export const REFERRAL_SHARE_TEXT =
	`Веду в Flux Planner еду, привычки и траты. Заходи по ссылке — ` +
	`после первой записи получишь ${REFERRAL_REWARD_DAYS} дней Pro.`;

/** Окно «Поделиться» Telegram: выбор чата и готовое сообщение со ссылкой. */
export function referralShareUrl(link: string, text: string = REFERRAL_SHARE_TEXT): string {
	return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
