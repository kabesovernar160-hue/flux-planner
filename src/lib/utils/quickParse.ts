/**
 * Разбор короткой строки в дело: что, когда, на какой день.
 *
 * Модуль общий для приложения и бота. Это не экономия кода, а требование
 * к поведению: «ужин на 19 00» должно давать один и тот же результат
 * и в строке ввода на главной, и в переписке с ботом. Две реализации
 * разошлись бы на первой же формулировке.
 *
 * Работает без сети и без модели — поэтому быстрый ввод остаётся
 * мгновенным и доступным офлайн.
 */

/**
 * Время люди пишут как угодно: «19:00», «19.00», «19 00», «в 19», «на 19»,
 * «к 19», «19ч». Не понять их — значит отправить человека заполнять форму.
 *
 * Границы слова (\b) здесь не используются: в JavaScript они опираются
 * на латиницу, и «в 7» в начале строки просто не совпадёт.
 */
const TIME_WITH_MINUTES =
	/(?:^|\s)(?:в|на|к)?\s*([01]?\d|2[0-3])[:.\s]([0-5]\d)(?:\s*(?:ч|час[а-я]*))?(?=\s|$)/;
const TIME_HOUR_ONLY = /(?:^|\s)(?:в|на|к)\s*([01]?\d|2[0-3])(?:\s*(?:ч|час[а-я]*))?(?=\s|$)/;
const TIME_HOUR_SUFFIX = /(?:^|\s)([01]?\d|2[0-3])\s*(?:ч|час[а-я]*)(?=\s|$)/;

/**
 * Части суток.
 *
 * Значения приблизительные и намеренно консервативные: «вечером» — это
 * не точное время, и лучше поставить разумный час, который человек поправит,
 * чем не поставить ничего.
 */
const DAY_PARTS: [RegExp, string][] = [
	[/утром/, '09:00'],
	[/днём|днем/, '13:00'],
	[/вечером/, '19:00'],
	[/ночью/, '22:00']
];

/** Слова, которые несут смысл для разбора, но не должны попадать в название. */
const NOISE = new RegExp(
	'(?:^|\\s)(?:' +
		[
			'сегодня',
			'завтра',
			'вчера',
			'запланировано',
			'запланировал[а]?',
			'планирую',
			'буду',
			'надо',
			'нужно',
			'утром',
			'днём',
			'днем',
			'вечером',
			'ночью',
			'на',
			'в',
			'к',
			'у меня'
		].join('|') +
		')(?=\\s|$)',
	'gi'
);

export interface QuickEntry {
	title: string;
	time?: string;
	/** 0 — сегодня, 1 — завтра, -1 — вчера. */
	dayOffset: number;
}

export function extractTime(text: string): string | undefined {
	const lower = text.toLowerCase();

	const withMinutes = lower.match(TIME_WITH_MINUTES);
	if (withMinutes) return `${withMinutes[1].padStart(2, '0')}:${withMinutes[2]}`;

	const hourOnly = lower.match(TIME_HOUR_ONLY);
	if (hourOnly) return `${hourOnly[1].padStart(2, '0')}:00`;

	const suffix = lower.match(TIME_HOUR_SUFFIX);
	if (suffix) return `${suffix[1].padStart(2, '0')}:00`;

	for (const [pattern, time] of DAY_PARTS) {
		if (pattern.test(lower)) return time;
	}

	return undefined;
}

export function extractDayOffset(text: string): number {
	const lower = text.toLowerCase();
	if (lower.includes('послезавтра')) return 2;
	if (lower.includes('завтра')) return 1;
	if (lower.includes('вчера')) return -1;
	return 0;
}

/**
 * Название без времени, дня и служебных слов.
 *
 * Порядок важен: сначала убирается время целиком, иначе от «в 19:00»
 * остаются двоеточие и обрывки. Если после чистки ничего не осталось,
 * возвращается исходный текст — пустое название хуже неаккуратного.
 */
export function cleanTitle(text: string): string {
	const cleaned = text
		.replace(TIME_WITH_MINUTES, ' ')
		.replace(TIME_HOUR_ONLY, ' ')
		.replace(TIME_HOUR_SUFFIX, ' ')
		.replace(NOISE, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	const result = cleaned || text.trim();
	if (!result) return 'Дело';

	// Первая буква заглавная: список из «ужин» и «Тренировка» вперемешку
	// выглядит небрежно, а правило проще, чем просить об этом человека.
	return result.charAt(0).toUpperCase() + result.slice(1);
}

export function parseQuickEntry(text: string): QuickEntry {
	return {
		title: cleanTitle(text),
		time: extractTime(text),
		dayOffset: extractDayOffset(text)
	};
}
