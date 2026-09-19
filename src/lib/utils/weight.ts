/**
 * Правила про вес, не зависящие ни от хранилища, ни от интерфейса.
 *
 * Отдельный модуль нужен серверу: бот принимает «вес 78,4» в чате, и тянуть
 * ради двух чисел клиентский стор со своим состоянием он не должен.
 */

/**
 * Границы разумного.
 *
 * Не медицинская норма, а защита от опечатки: «7.8» вместо «78» и «780»
 * вместо «78,0» — обычные промахи по цифровой клавиатуре, а в графике такая
 * запись рисует обрыв, который потом ищут глазами.
 */
export const MIN_WEIGHT_KG = 20;
export const MAX_WEIGHT_KG = 400;

/**
 * Насколько вес должен разойтись с анкетой, чтобы предлагать пересчёт целей.
 *
 * Полтора килограмма — за пределами суточных колебаний воды и еды, но ещё
 * не «раз в полгода». Предлагать на каждые сто граммов значит научить
 * человека закрывать предложение не читая.
 */
export const GOAL_REFRESH_THRESHOLD_KG = 1.5;

export function isWeightInRange(weightKg: number): boolean {
	return Number.isFinite(weightKg) && weightKg >= MIN_WEIGHT_KG && weightKg <= MAX_WEIGHT_KG;
}

/** Бытовые весы дают один знак после запятой; хранить хвост от арифметики незачем. */
export function roundWeight(weightKg: number): number {
	return Math.round(weightKg * 100) / 100;
}

export function validateWeight(weightKg: unknown): Record<string, string> {
	if (typeof weightKg !== 'number' || !Number.isFinite(weightKg)) {
		return { weightKg: 'Укажите вес числом' };
	}

	if (!isWeightInRange(weightKg)) {
		return { weightKg: `Вес должен быть между ${MIN_WEIGHT_KG} и ${MAX_WEIGHT_KG} кг` };
	}

	return {};
}

/**
 * Сообщение вида «вес 78,4».
 *
 * Разбирается правилом, а не моделью: взвешивание — короткая цифра, которую
 * человек шлёт каждое утро, и гонять ради неё запрос к ИИ значит платить
 * за то, что надёжнее делает регулярное выражение.
 *
 * Возвращает null для всего остального, в том числе для «450 борщ»: там
 * число — это калории, и перепутать их с килограммами нельзя.
 */
const WEIGHT_MESSAGE = /^\s*вес[\s:]+(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:кг)?\s*$/i;

export function parseWeightMessage(text: string): number | null {
	const match = WEIGHT_MESSAGE.exec(text);
	if (!match) return null;

	const value = Number(match[1].replace(',', '.'));
	return isWeightInRange(value) ? roundWeight(value) : null;
}
