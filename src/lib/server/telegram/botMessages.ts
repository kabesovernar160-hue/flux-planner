import type { FoodScanResult } from '$lib/types/nutrition';
import { confidenceLevel } from '$lib/utils/foodScan';

/**
 * Тексты и клавиатуры бота.
 *
 * Отдельный модуль без обращений к окружению и сети: так формулировки и разметку
 * можно покрыть тестами, не поднимая ни базу, ни Bot API, и они не расползаются
 * по обработчику вместе с логикой.
 */

export const WELCOME_TEXT = [
	'Привет! 👋',
	'',
	'Flux Planner — твой личный планировщик питания, привычек и финансов.',
	'Открой приложение, чтобы продолжить.'
].join('\n');

export const OPEN_APP_BUTTON = '🚀 Открыть Flux Planner';

export const HELP_TEXT = [
	'Что я умею прямо здесь:',
	'',
	'• Пришлите фото блюда — разберу его на продукты и покажу оценку.',
	'• Напишите «450 борщ» — запишу калории с названием.',
	'',
	'Записывать в дневник буду только после вашего подтверждения.',
	'Полная картина дня — в приложении.',
	'',
	'Что-то неудобно или сломалось — напишите «/feedback» и дальше текст,',
	'он уйдёт прямо разработчику.'
].join('\n');

/** Показывается, когда приложение не настроено: врать про кнопку нельзя. */
export const APP_URL_MISSING_TEXT = [
	'Приложение пока не подключено к боту.',
	'',
	'Администратору: задайте TELEGRAM_MINI_APP_URL — публичный адрес Flux Planner по HTTPS.'
].join('\n');

/**
 * Ответы на просьбу отменить подписку.
 *
 * Бот обещает в сообщении об оплате: «напишите сюда „отмена“». Обещание
 * должно исполняться — и объяснять, что именно произошло: отмена
 * автопродления не отбирает оплаченный месяц, и человек должен это знать,
 * иначе он придёт в поддержку за возвратом за собственную отмену.
 */
export const SUBSCRIPTION_NONE_TEXT = [
	'Активной подписки нет — платить не за что.',
	'',
	'Распознавание по фото работает и на бесплатном тарифе, просто реже.'
].join('\n');

export function subscriptionCancelledText(expiresAt: string | null): string {
	const until = expiresAt
		? new Date(expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
		: null;

	return [
		'Автопродление отключено.',
		'',
		until
			? `Pro останется до ${until} — оплаченный период не сгорает.`
			: 'Оплаченный период не сгорает.',
		'Вернуть подписку можно в приложении в любой момент.'
	].join('\n');
}

/** Отмена не прошла: врать про успех нельзя — деньги спишутся снова. */
export const SUBSCRIPTION_CANCEL_FAILED_TEXT = [
	'Не получилось отключить автопродление.',
	'',
	'Это можно сделать в Telegram: Настройки → Мои звёзды → Подписки.'
].join('\n');

export interface InlineKeyboard {
	inline_keyboard: { text: string; web_app?: { url: string }; callback_data?: string }[][];
}

/**
 * Кнопка открытия Mini App.
 *
 * Telegram принимает в web_app только HTTPS и отвергает запрос целиком, если
 * адрес не такой. Проверяем заранее: сообщение без кнопки лучше, чем ошибка
 * Bot API вместо ответа.
 */
export function isValidMiniAppUrl(url: string | undefined): boolean {
	if (!url) return false;

	try {
		return new URL(url).protocol === 'https:';
	} catch {
		return false;
	}
}

export function miniAppKeyboard(url: string | undefined): InlineKeyboard | undefined {
	if (!isValidMiniAppUrl(url)) return undefined;
	return { inline_keyboard: [[{ text: OPEN_APP_BUTTON, web_app: { url: url as string } }]] };
}

/** Клавиатура подтверждения разбора: записать или открыть приложение и поправить. */
export function confirmScanKeyboard(scanId: string, appUrl: string | undefined): InlineKeyboard {
	const rows: InlineKeyboard['inline_keyboard'] = [
		[
			{ text: '✅ Записать', callback_data: `scan:save:${scanId}` },
			{ text: '✖️ Отмена', callback_data: `scan:drop:${scanId}` }
		]
	];

	if (isValidMiniAppUrl(appUrl)) {
		rows.push([{ text: '✏️ Поправить в приложении', web_app: { url: appUrl as string } }]);
	}

	return { inline_keyboard: rows };
}

const CONFIDENCE_NOTE = {
	high: 'Вес порции всё равно стоит проверить.',
	medium: 'Оценка примерная: проверьте вес порции.',
	low: 'Уверенность низкая — по фото порцию определить трудно.'
} as const;

function round(value: number): string {
	return String(Math.round(value));
}

/**
 * Разбор фотографии текстом.
 *
 * Компоненты перечисляются по отдельности ровно по той же причине, что и
 * в приложении: «550 ккал» одной строкой невозможно проверить, а «курица 150 г,
 * рис 200 г» — вполне.
 */
export function formatScanMessage(result: FoodScanResult): string {
	const lines = ['Вот что я вижу:', ''];

	for (const item of result.items) {
		lines.push(`• ${item.name} — ${round(item.estimatedGrams)} г · ${round(item.calories)} ккал`);
	}

	lines.push('');
	lines.push(`Итого: ${round(result.totals.calories)} ккал`);
	lines.push(
		`Б ${round(result.totals.protein)} · Ж ${round(result.totals.fat)} · У ${round(result.totals.carbs)}`
	);
	lines.push('');
	lines.push(CONFIDENCE_NOTE[confidenceLevel(result.overallConfidence)]);
	lines.push('В дневник ничего не записано — нажмите «Записать» или поправьте в приложении.');

	return lines.join('\n');
}

export function formatSavedMessage(result: FoodScanResult): string {
	const names = result.items.map((item) => item.name).join(', ');
	return `Записал: ${names} — ${round(result.totals.calories)} ккал. Поправить порции можно в приложении.`;
}

export const NO_FOOD_TEXT = [
	'Не удалось уверенно определить еду на фото.',
	'',
	'Попробуйте снять блюдо целиком при нормальном свете или добавьте его вручную в приложении.'
].join('\n');
