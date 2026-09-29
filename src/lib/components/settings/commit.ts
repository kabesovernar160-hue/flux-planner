import { telegram } from '$lib/telegram';

/**
 * Применить целое число из поля настроек.
 *
 * Запятая принимается наравне с точкой: русская раскладка цифровой
 * клавиатуры на телефоне даёт именно её. Значение вне пределов молча
 * отбрасывается — поле при следующей отрисовке вернёт прежнюю цифру,
 * и это понятнее всплывающей ошибки посреди ввода.
 */
export function commitInteger(
	raw: string,
	apply: (value: number) => void,
	min = 0,
	max = 100_000
): void {
	const parsed = Number(raw.trim().replace(',', '.'));
	if (!Number.isFinite(parsed) || parsed < min || parsed > max) return;
	apply(Math.round(parsed));
	telegram.haptic.impact('light');
}
