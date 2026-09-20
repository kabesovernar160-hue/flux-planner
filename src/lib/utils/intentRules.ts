import { extractDayOffset, extractTime } from './quickParse';
import { isWeightInRange, roundWeight } from './weight';
import { mealForHour, type MealType } from './meals';

/**
 * Разбор короткой фразы в запись — правилами, без модели.
 *
 * Быстрая запись должна работать мгновенно, офлайн и бесплатно: человек
 * диктует «ужин в 19:00» на ходу и ждёт подтверждения, а не поездки
 * к провайдеру и обратно. Модель остаётся для того, что правила честно
 * не разобрали, — так она стоит денег только там, где действительно нужна.
 *
 * Правила описывают живую речь, а не грамматику: «в 7 вечера», «через час»,
 * «1.5к на такси», «450 борщ». Чего разобрать не удалось, помечается как
 * непонятое — выдуманная запись в дневнике хуже отсутствующей.
 *
 * Границы слова (\b) здесь не используются намеренно: в JavaScript они
 * опираются на латиницу, и «в 7» в начале строки просто не совпадёт.
 */

export type RuleIntentKind = 'plan' | 'food' | 'expense' | 'income' | 'weight' | 'unknown';

export interface RuleIntent {
	kind: RuleIntentKind;
	title: string;
	/** ЧЧ:ММ, если время названо или выводится из фразы. */
	time?: string;
	/** 0 — сегодня, 1 — завтра, −1 — вчера. Дальше недели не уходит. */
	dayOffset: number;
	amount?: number;
	grams?: number;
	calories?: number;
	weightKg?: number;
	meal?: MealType;
	/** 0…1. Ниже 0,5 — повод отдать фразу модели, если она подключена. */
	confidence: number;
}

export interface RuleOptions {
	/** Момент разбора: нужен для «через час» и «сейчас». */
	now?: Date;
	/** Часовой пояс человека: «через час» считается от его времени. */
	timeZone?: string;
}

/* ───────────────────────────── Время ───────────────────────────── */

/** «в 7 вечера», «в 8 утра», «в 9 ночи», «в 2 дня». */
const HOUR_WITH_PART = /(?:^|\s)(?:в|к|на)?\s*([01]?\d|2[0-3])\s*(утра|дня|вечера|ночи)(?=\s|$)/;

/** «через час», «через 20 минут», «через 2 часа», «через полчаса». */
const RELATIVE = /(?:^|\s)через\s+(полчаса|час|\d{1,3})\s*(минут[а-я]*|час[а-я]*)?(?=\s|$)/;

const NOW_WORDS = /(?:^|\s)(?:сейчас|только что|щас)(?=\s|$)/;

/**
 * Час из «7 вечера» в двадцатичетырёхчасовой.
 *
 * «12 ночи» — это полночь, «12 дня» — полдень: единственные два случая,
 * где прибавление двенадцати даёт неверный ответ.
 */
function hourFromPart(hour: number, part: string): number {
	if (part === 'утра') return hour === 12 ? 0 : hour;
	if (part === 'ночи') return hour === 12 ? 0 : hour < 5 ? hour : (hour + 12) % 24;
	if (hour === 12) return 12;
	return hour < 12 ? hour + 12 : hour;
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/** Час и минута в поясе человека: «через час» отсчитывается от его времени. */
function localParts(date: Date, timeZone?: string): { hour: number; minute: number } {
	try {
		const formatted = new Intl.DateTimeFormat('en-GB', {
			timeZone: timeZone || undefined,
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		}).format(date);

		const [hour, minute] = formatted.split(':').map(Number);
		if (Number.isFinite(hour) && Number.isFinite(minute)) return { hour, minute };
	} catch {
		// Битый пояс не повод отказываться от разбора.
	}

	return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

export function resolveTime(text: string, options: RuleOptions = {}): string | undefined {
	const lower = text.toLowerCase();
	const now = options.now ?? new Date();

	const relative = lower.match(RELATIVE);
	if (relative) {
		const word = relative[1];
		const unit = relative[2] ?? '';
		const minutes =
			word === 'полчаса'
				? 30
				: word === 'час'
					? 60
					: unit.startsWith('час')
						? Number(word) * 60
						: Number(word);

		if (Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60) {
			const { hour, minute } = localParts(now, options.timeZone);
			const total = (hour * 60 + minute + minutes) % (24 * 60);
			return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
		}
	}

	if (NOW_WORDS.test(lower)) {
		const { hour, minute } = localParts(now, options.timeZone);
		return `${pad(hour)}:${pad(minute)}`;
	}

	const withPart = lower.match(HOUR_WITH_PART);
	if (withPart) {
		const hour = hourFromPart(Number(withPart[1]), withPart[2]);
		return `${pad(hour)}:00`;
	}

	return extractTime(text);
}

/* ───────────────────────────── День ───────────────────────────── */

const WEEKDAYS: [RegExp, number][] = [
	[/понедельник/, 1],
	[/вторник/, 2],
	[/сред[ауы]/, 3],
	[/четверг/, 4],
	[/пятниц/, 5],
	[/суббот/, 6],
	[/воскресень/, 0]
];

const IN_DAYS = /(?:^|\s)через\s+(\d{1,2})\s*(?:дн[ея][йь]?|дня|дней|день)(?=\s|$)/;
const IN_WEEK = /(?:^|\s)через\s+недел[юя](?=\s|$)/;

/** Номер дня недели в поясе человека: 0 — воскресенье. */
function localWeekday(date: Date, timeZone?: string): number {
	try {
		const name = new Intl.DateTimeFormat('en-US', {
			timeZone: timeZone || undefined,
			weekday: 'short'
		}).format(date);

		const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
		if (index >= 0) return index;
	} catch {
		// см. localParts
	}

	return date.getUTCDay();
}

/**
 * Сдвиг дня из фразы.
 *
 * «В пятницу» означает ближайшую будущую пятницу, а не сегодняшнюю: если
 * человек говорит о сегодняшнем дне, он говорит «сегодня». Дальше недели
 * разбор не уходит — планировщик на месяц вперёд из одной строки
 * не собирается, а ошибка на тридцать дней незаметна.
 */
export function resolveDayOffset(text: string, options: RuleOptions = {}): number {
	const lower = text.toLowerCase();
	const now = options.now ?? new Date();

	if (IN_WEEK.test(lower)) return 7;

	const inDays = lower.match(IN_DAYS);
	if (inDays) {
		const days = Number(inDays[1]);
		if (Number.isFinite(days) && days > 0) return Math.min(7, days);
	}

	const base = extractDayOffset(text);
	if (base !== 0) return base;

	for (const [pattern, weekday] of WEEKDAYS) {
		if (!pattern.test(lower)) continue;

		const today = localWeekday(now, options.timeZone);
		const diff = (weekday - today + 7) % 7;
		return diff === 0 ? 7 : diff;
	}

	return 0;
}

/* ───────────────────────────── Числа ───────────────────────────── */

/** «1.5к», «2к», «500к» — разговорные тысячи. */
const THOUSANDS = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:к|k|тыс[а-я.]*)(?=\s|$)/;

/** «500 ₽», «500р», «500 руб», «500 рублей». */
const MONEY_WITH_UNIT = /(?:^|\s)(\d[\d\s]{0,8})\s*(?:₽|р|руб[а-я.]*|rub)(?=\s|$)/i;

/** Просто число: последний шанс распознать сумму. */
const BARE_NUMBER = /(?:^|\s)(\d[\d\s]{0,8})(?=\s|$)/;

const CALORIES = /(?:^|\s)(\d{2,5})\s*(?:ккал|калори[а-я]*|kcal)(?=\s|$)/i;
const GRAMS = /(?:^|\s)(\d{1,5})\s*(?:г|гр|грамм[а-я]*|g)(?=\s|$)/i;
const WEIGHT = /(?:^|\s)вес[\s:]+(\d{2,3}(?:[.,]\d{1,2})?)(?=\s|$)/i;

function toNumber(raw: string): number {
	return Number(raw.replace(/\s/g, '').replace(',', '.'));
}

export function extractAmount(text: string): number | undefined {
	const lower = text.toLowerCase();

	const thousands = lower.match(THOUSANDS);
	if (thousands) {
		const value = toNumber(thousands[1]) * 1000;
		if (Number.isFinite(value) && value > 0) return value;
	}

	const withUnit = lower.match(MONEY_WITH_UNIT);
	if (withUnit) {
		const value = toNumber(withUnit[1]);
		if (Number.isFinite(value) && value > 0) return value;
	}

	const bare = lower.match(BARE_NUMBER);
	if (bare) {
		const value = toNumber(bare[1]);
		if (Number.isFinite(value) && value > 0) return value;
	}

	return undefined;
}

/* ───────────────────────────── Слова ───────────────────────────── */

const FOOD_VERBS = [
	'съел',
	'съела',
	'ел ',
	'ела ',
	'поел',
	'поела',
	'позавтракал',
	'пообедал',
	'поужинал',
	'перекусил',
	'выпил',
	'выпила'
];

const EXPENSE_VERBS = [
	'потратил',
	'потратила',
	'купил',
	'купила',
	'оплатил',
	'оплатила',
	'заплатил',
	'заплатила',
	'отдал',
	'списали',
	'ушло на'
];

const INCOME_WORDS = [
	'зарплат',
	'премия',
	'премию',
	'получил',
	'получила',
	'вернули',
	'кешбэк',
	'кэшбек',
	'доход',
	'аванс'
];

const PLAN_VERBS = [
	'запланир',
	'план ',
	'буду',
	'схожу',
	'сходить',
	'надо',
	'нужно',
	'напомни',
	'встреч',
	'созвон'
];

/** Существительные, которые сами по себе означают дело на день. */
const PLAN_NOUNS = [
	'трениров',
	'зал',
	'бег',
	'йог',
	'бассейн',
	'врач',
	'звонок',
	'позвонить',
	'прогулк',
	'уборк',
	'отчёт',
	'отчет',
	'дедлайн',
	'урок',
	'учёб',
	'учеб'
];

/** Приёмы пищи: и признак еды, и подсказка, в какой приём её писать. */
const MEAL_WORDS: [RegExp, MealType][] = [
	[/завтрак/, 'breakfast'],
	[/обед/, 'lunch'],
	[/ужин/, 'dinner'],
	[/перекус/, 'snack']
];

/** Приветствия и вопросы записывать в дневник нечего. */
const SMALL_TALK = ['привет', 'здравств', 'как дела', 'спасибо', 'ок', 'хорошо', 'ага', 'помощь'];

function includesAny(text: string, words: string[]): boolean {
	return words.some((word) => text.includes(word));
}

export function extractMeal(text: string): MealType | undefined {
	const lower = text.toLowerCase();
	for (const [pattern, meal] of MEAL_WORDS) {
		if (pattern.test(lower)) return meal;
	}
	return undefined;
}

/* ───────────────────────────── Название ───────────────────────────── */

/** Служебные слова, которые несут смысл разбору, но не нужны в названии. */
const TITLE_NOISE = new RegExp(
	'(?:^|\\s)(?:' +
		[
			'сегодня',
			'завтра',
			'послезавтра',
			'вчера',
			'сейчас',
			'щас',
			'через',
			'полчаса',
			'утра',
			'дня',
			'вечера',
			'ночи',
			'утром',
			'днём',
			'днем',
			'вечером',
			'ночью',
			'запланировал[а]?',
			'запланировать',
			'планирую',
			'напомни[ть]?',
			'надо',
			'нужно',
			'буду',
			'потратил[а]?',
			'купил[а]?',
			'оплатил[а]?',
			'заплатил[а]?',
			'отдал[а]?',
			'получил[а]?',
			'съел[а]?',
			'поел[а]?',
			'выпил[а]?',
			'позавтракал[а]?',
			'пообедал[а]?',
			'поужинал[а]?',
			'перекусил[а]?',
			'вес',
			'ккал',
			'калори[а-я]*',
			'руб[а-я.]*',
			'рублей',
			'на',
			'в',
			'к',
			'за',
			'по'
		].join('|') +
		')(?=\\s|$)',
	'gi'
);

const NUMBERS_AND_TIME =
	/(?:^|\s)\d+(?:[.,:]\d+)?\s*(?:ч|час[а-я]*|г|гр|грамм[а-я]*|₽|р|к|k)?(?=\s|$)/g;

/**
 * Название без служебных слов, времени и чисел.
 *
 * Если после чистки ничего не осталось — возвращается исходная фраза:
 * неаккуратное название лучше пустого, по нему человек хотя бы поймёт,
 * что он записывал.
 */
export function cleanupTitle(text: string): string {
	const cleaned = text
		.replace(NUMBERS_AND_TIME, ' ')
		.replace(TITLE_NOISE, ' ')
		.replace(/[«»"'`]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	const result = cleaned || text.trim();
	if (!result) return '';

	return result.charAt(0).toUpperCase() + result.slice(1);
}

/* ───────────────────────────── Разбор ───────────────────────────── */

/**
 * Разбор фразы в запись.
 *
 * Порядок проверок задаёт приоритет и придуман не из красоты: прошедшее
 * время про еду важнее упоминания часа, иначе «съел в 14 суп» уехало бы
 * в планы; вес проверяется первым, потому что «вес 78» — это два числа
 * подряд и в любом другом порядке стало бы едой на 78 килокалорий.
 */
export function parseIntentByRules(text: string, options: RuleOptions = {}): RuleIntent {
	const trimmed = text.trim();
	const lower = trimmed.toLowerCase();

	const empty: RuleIntent = { kind: 'unknown', title: '', dayOffset: 0, confidence: 0 };
	if (!trimmed) return empty;

	// Вес: «вес 78,4».
	const weight = lower.match(WEIGHT);
	if (weight) {
		const value = toNumber(weight[1]);
		if (isWeightInRange(value)) {
			return {
				kind: 'weight',
				title: 'Вес',
				dayOffset: resolveDayOffset(trimmed, options),
				weightKg: roundWeight(value),
				confidence: 0.95
			};
		}
	}

	if (includesAny(lower, SMALL_TALK) && trimmed.length < 20) return empty;

	const time = resolveTime(trimmed, options);
	const dayOffset = resolveDayOffset(trimmed, options);
	const meal = extractMeal(trimmed);
	const title = cleanupTitle(trimmed);

	const calorieMatch = lower.match(CALORIES);
	const gramsMatch = lower.match(GRAMS);

	// «450 борщ» — человек сам назвал калории, и это самая частая
	// форма быстрой записи еды.
	const leadingCalories = /^\s*(\d{2,5})\s+\D/.exec(trimmed);

	const calories = calorieMatch
		? toNumber(calorieMatch[1])
		: leadingCalories
			? toNumber(leadingCalories[1])
			: undefined;

	const grams = gramsMatch ? toNumber(gramsMatch[1]) : undefined;

	const isFood =
		includesAny(lower, FOOD_VERBS) ||
		calorieMatch !== null ||
		(leadingCalories !== null && !includesAny(lower, EXPENSE_VERBS)) ||
		(meal !== undefined && (gramsMatch !== null || calorieMatch !== null));

	if (isFood) {
		return {
			kind: 'food',
			title: title || 'Еда',
			dayOffset,
			calories,
			grams,
			meal: meal ?? (time ? mealForHour(Number(time.slice(0, 2))) : undefined),
			confidence: calories ? 0.85 : 0.6
		};
	}

	const amount = extractAmount(trimmed);

	if (includesAny(lower, EXPENSE_VERBS) && amount) {
		return { kind: 'expense', title: title || 'Трата', dayOffset, amount, confidence: 0.85 };
	}

	if (includesAny(lower, INCOME_WORDS) && amount) {
		return { kind: 'income', title: title || 'Доход', dayOffset, amount, confidence: 0.85 };
	}

	const looksLikePlan =
		includesAny(lower, PLAN_VERBS) ||
		includesAny(lower, PLAN_NOUNS) ||
		meal !== undefined ||
		time !== undefined;

	if (looksLikePlan && title) {
		return {
			kind: 'plan',
			title,
			time,
			dayOffset,
			// Время названо — почти наверняка дело. Без времени это догадка
			// по одному существительному, и модель разберёт фразу лучше.
			confidence: time ? 0.8 : 0.5
		};
	}

	return { ...empty, title };
}
