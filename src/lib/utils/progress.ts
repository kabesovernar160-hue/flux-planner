/**
 * Общие вычисления прогресса.
 *
 * Вынесены из nutrition.ts, когда те же формулы понадобились финансам:
 * два independent-деления в разных модулях рано или поздно разойдутся
 * в обработке нуля и NaN.
 */

/**
 * Доля выполнения, 0…1 и выше.
 *
 * Единственное место в приложении, где выполняется это деление.
 * Нулевая, отрицательная или нечисловая цель даёт 0: бесконечность или NaN,
 * попав в атрибут SVG или в ширину полосы, ломает отрисовку молча.
 */
export function progressRatio(consumed: number, goal: number): number {
	if (!Number.isFinite(consumed) || !Number.isFinite(goal) || goal <= 0) return 0;
	const value = consumed / goal;
	return Number.isFinite(value) ? value : 0;
}

/** Доля → проценты. Может быть больше 100 — это осмысленное превышение. */
export function toPercent(ratio: number): number {
	return Number.isFinite(ratio) ? ratio * 100 : 0;
}

/** Обрезанное для отрисовки значение: полоса не должна вылезать за контейнер. */
export function clampProgress(percent: number): number {
	if (!Number.isFinite(percent)) return 0;
	return Math.min(100, Math.max(0, percent));
}
