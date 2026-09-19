import { cleanTitle, extractDayOffset, extractTime } from '$lib/utils/quickParse';
import type { ParsedIntent } from '../intentSchema';

/**
 * Разбор сообщения без модели: правила по ключевым словам.
 *
 * Используется, когда ключа ИИ нет или провайдер недоступен. Он заметно
 * грубее модели, но простые фразы — «в 19:00 ужин», «потратил 500 на такси» —
 * разбирает верно, а сложные честно помечает как непонятые. Это рабочая
 * деградация, а не заглушка для тестов.
 *
 * Границы слова (\b) здесь намеренно не используются: в JavaScript они
 * опираются на латиницу, и «в 7» в начале строки просто не совпадает.
 */

const AMOUNT = /(?:^|\s)(\d[\d\s]{0,8})(?:\s*(?:р|руб|₽|rub))?(?=\s|$)/i;

const FOOD_WORDS = ['съел', 'съела', 'поел', 'пообедал', 'позавтракал', 'поужинал', 'выпил'];
const EXPENSE_WORDS = ['потратил', 'потратила', 'купил', 'купила', 'оплатил', 'заплатил'];
const INCOME_WORDS = ['зарплат', 'получил', 'вернули', 'премия', 'премию', 'доход'];
const PLAN_WORDS = ['план', 'запланир', 'буду', 'схожу', 'надо', 'нужно', 'сходить'];

/**
 * Существительные, которые сами по себе означают дело на день.
 *
 * «Ужин на 19 00» — это план, хотя в нём нет ни одного глагола.
 * Без такого списка самая частая формулировка не распознавалась бы.
 */
const PLAN_NOUNS = [
	'завтрак',
	'обед',
	'ужин',
	'перекус',
	'трениров',
	'зал',
	'бег',
	'йог',
	'бассейн',
	'врач',
	'встреч',
	'звонок',
	'позвонить',
	'прогулк',
	'уборк',
	'отчёт',
	'отчет',
	'дедлайн',
	'созвон'
];

/** Приветствия и вопросы записывать в дневник нечего. */
const SMALL_TALK = ['привет', 'здравств', 'как дела', 'спасибо', 'ок', 'хорошо', 'ага'];

export function parseIntentLocally(text: string): ParsedIntent {
	const lower = text.toLowerCase();

	const dayOffset = extractDayOffset(text);
	const time = extractTime(text);

	const amountMatch = lower.match(AMOUNT);
	const amount = amountMatch ? Number(amountMatch[1].replace(/\s/g, '')) : 0;

	const has = (words: string[]) => words.some((word) => lower.includes(word));

	// Порядок проверок задаёт приоритет: прошедшее время про еду важнее
	// упоминания часа, иначе «съел в 14 суп» уехало бы в планы.
	let kind: ParsedIntent['kind'] = 'unknown';
	if (has(SMALL_TALK) && lower.length < 20) kind = 'unknown';
	else if (has(FOOD_WORDS)) kind = 'food';
	else if (has(EXPENSE_WORDS)) kind = 'expense';
	else if (has(INCOME_WORDS)) kind = 'income';
	else if (has(PLAN_WORDS) || has(PLAN_NOUNS) || time) kind = 'plan';

	// Трата без суммы — это не трата: писать ноль в дневник расходов
	// бессмысленно, такое сообщение честнее оставить планом.
	if ((kind === 'expense' || kind === 'income') && !amount) kind = 'plan';

	return {
		kind,
		title: cleanTitle(text),
		time,
		dayOffset,
		amount: kind === 'expense' || kind === 'income' ? amount : undefined,
		confidence: kind === 'unknown' ? 0.2 : 0.65
	};
}
