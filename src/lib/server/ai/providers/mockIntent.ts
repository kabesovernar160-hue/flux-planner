import { parseIntentByRules } from '$lib/utils/intentRules';
import type { ParsedIntent } from '../intentSchema';

/**
 * Разбор сообщения без модели.
 *
 * Правила живут в $lib/utils/intentRules — общем модуле для чата, приложения
 * и быстрой записи с телефона: «ужин в 19:00» обязано давать один результат
 * везде, а три реализации разошлись бы на первой же формулировке.
 *
 * Здесь остаётся только приведение к контракту разбора: он старше правил
 * и знает четыре вида записей.
 */
export function parseIntentLocally(text: string): ParsedIntent {
	const intent = parseIntentByRules(text);

	// Вес правила распознают, а контракт разбора — нет: в чате он ловится
	// отдельной проверкой до разбора, и дублировать его здесь незачем.
	const kind: ParsedIntent['kind'] = intent.kind === 'weight' ? 'unknown' : intent.kind;

	return {
		kind,
		title: intent.title,
		time: intent.time,
		dayOffset: intent.dayOffset,
		amount: intent.amount,
		grams: intent.grams,
		calories: intent.calories,
		meal: intent.meal,
		confidence: kind === 'unknown' ? Math.min(intent.confidence, 0.2) : intent.confidence
	};
}
