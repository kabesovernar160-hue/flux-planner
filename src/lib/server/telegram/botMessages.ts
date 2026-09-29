import type { FoodScanResult } from '$lib/types/nutrition';
import { confidenceLevel } from '$lib/utils/foodScan';

/**
 * Тексты и клавиатуры бота.
 *
 * Отдельный модуль без обращений к окружению и сети: так формулировки и разметку
 * можно покрыть тестами, не поднимая ни базу, ни Bot API, и они не расползаются
 * по обработчику вместе с логикой.
 */

/**
 * Первое, что человек читает после «Начать».
 *
 * Не о том, какой планировщик хороший, а о том, что сделать прямо сейчас.
 * Из новичков недели больше трети нажимали «Начать» и дальше приложение
 * не открывали, поэтому первая запись должна случаться прямо здесь, одним
 * нажатием на пример под сообщением. Приложение остаётся следующим шагом,
 * а не входным билетом.
 */
export const WELCOME_TEXT = [
	'Flux Planner — питание, привычки и деньги одного дня на одном экране.',
	'',
	'Попробуйте прямо сейчас, не открывая приложение: нажмите пример ниже — он сразу запишется. ' +
		'Или напишите свою фразу: «ужин в 19:00», «1,5к на такси».',
	'',
	'Или пришлите фото еды — разберу на продукты и посчитаю калории.',
	'',
	'Весь день целиком — в приложении: пять вопросов, и цели посчитаются под вас. ' +
		'Там же включается запись голосом с телефона.'
].join('\n');

export const OPEN_APP_BUTTON = '🚀 Открыть Flux Planner';

/**
 * Примеры под приветствием и напоминаниями.
 *
 * Нажатие записывает ровно этот текст — тем же разбором, что и набранное
 * руками сообщение. Три разных вида записи: еда, трата и дело, чтобы
 * с первого нажатия было видно, что бот понимает не только калории.
 * Привычки из чата не заводятся, поэтому «зарядка» здесь — дело на время.
 */
export const TRY_EXAMPLES = ['450 борщ', 'кофе 300 ₽', 'зарядка в 8:00'] as const;

/**
 * В callback_data уходит номер примера, а не сам текст.
 *
 * Поле ограничено 64 байтами, кириллица занимает по два, и длинный пример
 * однажды молча перестал бы помещаться. Номер к тому же не даёт записать
 * через кнопку что-то, кроме наших примеров.
 */
const TRY_PREFIX = 'try:';

export function tryExampleCallback(index: number): string {
	return `${TRY_PREFIX}${index}`;
}

/** Текст примера по callback_data; всё чужое и устаревшее — null. */
export function exampleFromCallback(data: string | undefined): string | null {
	if (!data?.startsWith(TRY_PREFIX)) return null;

	const raw = data.slice(TRY_PREFIX.length);
	if (!/^\d+$/.test(raw)) return null;

	return TRY_EXAMPLES[Number(raw)] ?? null;
}

export const HELP_TEXT = [
	'Что я умею прямо здесь:',
	'',
	'• Пришлите фото блюда — разберу его на продукты и покажу оценку.',
	'• Напишите «450 борщ» — запишу калории с названием.',
	'',
	'Записывать в дневник буду только после вашего подтверждения.',
	'Полная картина дня — в приложении.',
	'Приложение на телефон без Telegram — команда /phone.',
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
	inline_keyboard: {
		text: string;
		web_app?: { url: string };
		url?: string;
		callback_data?: string;
	}[][];
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

/**
 * Примеры и кнопка приложения.
 *
 * Примеры идут первыми: это действие, ради которого сообщение написано.
 * Два коротких в ряд, третий отдельно — в три кнопки подряд на телефоне
 * подписи обрезаются. Без рабочего адреса примеры всё равно остаются:
 * записать из чата можно и без приложения.
 */
export function tryExamplesKeyboard(appUrl: string | undefined): InlineKeyboard {
	const button = (index: number) => ({
		text: `«${TRY_EXAMPLES[index]}»`,
		callback_data: tryExampleCallback(index)
	});

	const rows: InlineKeyboard['inline_keyboard'] = [[button(0), button(1)], [button(2)]];

	if (isValidMiniAppUrl(appUrl)) {
		rows.push([{ text: OPEN_APP_BUTTON, web_app: { url: appUrl as string } }]);
	}

	return { inline_keyboard: rows };
}

/**
 * Строка к самой первой записи из чата.
 *
 * Запись уже есть — самое время показать, где она живёт. Одна строка
 * и одна кнопка: человек только что сделал то, ради чего пришёл,
 * и лекция о возможностях приложения здесь была бы лишней.
 */
export const FIRST_RECORD_LINE =
	'Это ваша первая запись. Весь день — еда, дела и траты — в приложении.';

export const OPEN_DAY_BUTTON = '📅 Открыть мой день';

/**
 * Кнопка «Открыть мой день» под ответом.
 *
 * web_app на корень, а не ссылка startapp на шторку: главный экран
 * приложения и есть сегодняшний день, и запись из чата подтянется туда
 * первой же синхронизацией. Шторка «добавить еду» сразу после записи
 * еды читалась бы как «не записалось, добавьте ещё раз».
 */
export function withOpenDayButton(
	keyboard: InlineKeyboard | undefined,
	appUrl: string | undefined
): InlineKeyboard | undefined {
	if (!isValidMiniAppUrl(appUrl)) return keyboard;

	return {
		inline_keyboard: [
			...(keyboard?.inline_keyboard ?? []),
			[{ text: OPEN_DAY_BUTTON, web_app: { url: appUrl as string } }]
		]
	};
}

/**
 * Напоминания новичкам без единой записи.
 *
 * Их всего два за всю жизнь аккаунта, и каждое предлагает одно конкретное
 * действие с кнопкой, которая его выполняет. Без восклицательных знаков
 * и без «вы забыли»: человек никому ничего не должен, а упрёк от бота —
 * самый быстрый путь к кнопке «Заблокировать».
 */
export const FIRST_NUDGE_TEXT = [
	'Начнём с одной записи?',
	'',
	'Нажмите пример ниже — он сразу попадёт в дневник, отменить можно одной кнопкой. ' +
		'Или напишите своё так же коротко: «овсянка 350», «такси 400 ₽».'
].join('\n');

export const SECOND_NUDGE_TEXT = [
	'Одна запись в день — уже картина дня.',
	'',
	'Проще всего начать с обеда: пришлите фото тарелки или напишите «450 борщ» — ' +
		'калории посчитаю сам. Примеры ниже записываются одним нажатием.',
	'',
	'Больше напоминать не буду.'
].join('\n');

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

/**
 * Приложение на телефоне без Telegram: вход по ссылке из бота.
 *
 * Кнопка «📱 Приложение на телефон» (и команда /phone) выдаёт одноразовый
 * код. Ссылка идёт обычной url-кнопкой, а не web_app: её надо открыть
 * в браузере телефона — там приложение ставится на главный экран. Код
 * повторён текстом для айфона: приложение на главном экране не видит куку
 * Safari, и там его вводят руками.
 *
 * Ссылка — только в кнопке, не в тексте: превью ссылки в чате Telegram
 * строит запросом на сервер, и лишний визит на страницу входа ни к чему.
 */
export const PHONE_APP_BUTTON = '📱 Приложение на телефон';
export const PHONE_LOGIN_BUTTON = '📱 Войти на этом устройстве';
export const PHONE_LOGIN_CALLBACK = 'login';

export function phoneLoginText(code: string): string {
	return [
		'Flux Planner на главном экране телефона — без Telegram, со своей иконкой.',
		'',
		'1. Нажмите кнопку ниже — страница откроется в браузере.',
		'2. Нажмите «Войти» и добавьте приложение на главный экран.',
		'',
		'Если ссылка открылась внутри Telegram, откройте её в Safari или Chrome (меню «⋯»).',
		`Если приложение спросит код: ${code}`,
		'',
		'Ссылка и код работают 10 минут и только один раз.'
	].join('\n');
}

export function phoneLoginKeyboard(loginUrl: string): InlineKeyboard {
	return { inline_keyboard: [[{ text: PHONE_LOGIN_BUTTON, url: loginUrl }]] };
}

export const PHONE_LOGIN_RATE_LIMITED_TEXT =
	'Коды входа уже выданы несколько раз подряд. Подождите пару минут и попробуйте снова.';

/** Справка: кнопка приложения и вход на телефоне. */
export function helpKeyboard(appUrl: string | undefined): InlineKeyboard {
	const rows: InlineKeyboard['inline_keyboard'] = [];

	if (isValidMiniAppUrl(appUrl)) {
		rows.push([{ text: OPEN_APP_BUTTON, web_app: { url: appUrl as string } }]);
		rows.push([{ text: PHONE_APP_BUTTON, callback_data: PHONE_LOGIN_CALLBACK }]);
	}

	return { inline_keyboard: rows };
}
