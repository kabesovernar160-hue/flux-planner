import { z } from 'zod';
import { AiError } from './types';

/**
 * Разбор обычного сообщения в запись приложения.
 *
 * «Сегодня в 19:00 ужин» должно превращаться в пункт плана, «потратил 500
 * на такси» — в трату, «съел 2 яйца» — в запись о еде. Раньше для этого
 * нужно было открыть приложение, выбрать экран и заполнить форму; теперь
 * достаточно написать боту.
 *
 * Модель здесь занимается ровно одним: превращает свободный текст
 * в структуру. Ни калорий, ни курсов, ни выдуманных подробностей —
 * всё, чего в сообщении не было, остаётся пустым.
 */

export const intentSchema = z.object({
	kind: z
		.enum(['plan', 'food', 'expense', 'income', 'unknown'])
		.describe(
			'Что человек имел в виду: plan — планы и цели на день, food — что уже съел, ' +
				'expense — потратил, income — получил деньги, unknown — не удалось понять'
		),
	title: z.string().describe('Короткое название на русском: «Ужин», «Такси», «Овсянка»'),
	time: z.string().describe('Время в формате ЧЧ:ММ, если названо. Иначе пустая строка'),
	dayOffset: z.number().describe('0 — сегодня, 1 — завтра, -1 — вчера. Если день не назван, 0'),
	amount: z.number().describe('Сумма денег, если названа. Иначе 0'),
	grams: z.number().describe('Вес порции в граммах, если назван. Иначе 0'),
	calories: z.number().describe('Калории, если названы прямо. Не вычислять самому, иначе 0'),
	note: z.string().describe('Уточнение из сообщения или пустая строка'),
	confidence: z.number().describe('Уверенность в разборе от 0 до 1')
});

export type RawIntent = z.infer<typeof intentSchema>;

export type IntentKind = RawIntent['kind'];

export interface ParsedIntent {
	kind: IntentKind;
	title: string;
	time?: string;
	dayOffset: number;
	amount?: number;
	grams?: number;
	calories?: number;
	note?: string;
	confidence: number;
}

const MAX_TITLE = 120;
const MAX_NOTE = 300;
const MAX_AMOUNT = 100_000_000;
const MAX_GRAMS = 20_000;
const MAX_CALORIES = 20_000;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function clamp(value: number, max: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.min(max, value);
}

/**
 * Приведение ответа модели к безопасному виду.
 *
 * Ответ модели — недоверенные данные, даже когда исходный текст написал
 * сам пользователь. Время с мусором отбрасывается, суммы ограничиваются,
 * день сдвигается не дальше недели: «послезавтра» — нормально,
 * «через триста дней» из короткой фразы означает ошибку разбора.
 */
export function normalizeIntent(raw: unknown): ParsedIntent {
	const parsed = intentSchema.safeParse(raw);

	if (!parsed.success) {
		throw new AiError('INVALID_AI_RESPONSE', 'Не удалось разобрать сообщение', 502, parsed.error);
	}

	const data = parsed.data;
	const title = data.title.trim().slice(0, MAX_TITLE);

	if (!title) {
		return { kind: 'unknown', title: '', dayOffset: 0, confidence: 0 };
	}

	const time = TIME_PATTERN.test(data.time.trim()) ? data.time.trim() : undefined;
	const note = data.note.trim().slice(0, MAX_NOTE);

	const dayOffset = Number.isFinite(data.dayOffset)
		? Math.max(-7, Math.min(7, Math.trunc(data.dayOffset)))
		: 0;

	const amount = clamp(data.amount, MAX_AMOUNT);
	const grams = clamp(data.grams, MAX_GRAMS);
	const calories = clamp(data.calories, MAX_CALORIES);

	// Трата без суммы — это не трата, а пожелание. Такое сообщение
	// честнее записать как пункт плана, чем выдумывать число.
	const kind =
		(data.kind === 'expense' || data.kind === 'income') && amount === 0 ? 'plan' : data.kind;

	return {
		kind,
		title,
		time,
		dayOffset,
		amount: amount || undefined,
		grams: grams || undefined,
		calories: calories || undefined,
		note: note || undefined,
		confidence: Math.min(1, Math.max(0, Number.isFinite(data.confidence) ? data.confidence : 0))
	};
}
