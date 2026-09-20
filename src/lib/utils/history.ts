import { addDays, type DateKey } from './date';

/**
 * Граница доступной истории.
 *
 * Бесплатный тариф показывает последние N дней — это обещано в условиях,
 * в политике и в описании счёта. Записи при этом никуда не деваются: они
 * остаются на устройстве и в базе, просто аналитика и календарь до них
 * не пускают. Поэтому здесь именно «показывать с такого-то дня», а не
 * «удалить старше такого-то».
 *
 * Будущее не ограничивается: план на завтра — не история.
 */

/** Самый ранний день, который показывается. Сегодняшний день входит в счёт. */
export function historyStart(days: number, today: DateKey): DateKey {
	if (!Number.isFinite(days) || days <= 0) return today;
	return addDays(today, -(Math.floor(days) - 1));
}

/** Доступен ли день. Ключи дней сравниваются как строки: формат это позволяет. */
export function isWithinHistory(date: DateKey, days: number, today: DateKey): boolean {
	return date >= historyStart(days, today);
}
