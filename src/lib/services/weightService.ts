import { plannerStore } from '$lib/stores/plannerStore.svelte';
import type { WeightEntry } from '$lib/types/weight';
import { dateRange, type DayValue } from '$lib/utils/analytics';
import { addDays, type DateKey } from '$lib/utils/date';
import { GOAL_REFRESH_THRESHOLD_KG, roundWeight, validateWeight } from '$lib/utils/weight';
import type { ServiceResult } from './nutritionService';
import { saveProfile } from './profileService';

// Границы и порог живут в utils/weight: их читает и сервер, которому
// клиентский стор не нужен. Здесь они переизлучаются, чтобы интерфейсу
// не приходилось знать про два модуля вместо одного.
export {
	GOAL_REFRESH_THRESHOLD_KG,
	MAX_WEIGHT_KG,
	MIN_WEIGHT_KG,
	validateWeight
} from '$lib/utils/weight';

/**
 * Дневник веса.
 *
 * Правила проверки и вся арифметика динамики живут здесь, а не в компоненте:
 * те же цифры показывает аналитика и (позже) сводка в чате, и две реализации
 * одного расчёта разошлись бы на первой же правке.
 */

export function recordWeight(
	weightKg: number,
	date?: DateKey,
	note?: string
): ServiceResult<WeightEntry> {
	const errors = validateWeight(weightKg);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	const rounded = roundWeight(weightKg);
	const entry = plannerStore.setWeight(rounded, date, note?.trim() || undefined);

	return entry
		? { ok: true, value: entry }
		: { ok: false, errors: { weightKg: 'Не удалось записать' } };
}

export function removeWeight(date: DateKey): void {
	plannerStore.removeWeight(date);
}

export function getWeight(date: DateKey): WeightEntry | undefined {
	return plannerStore.getWeight(date);
}

export function latestWeight(): WeightEntry | null {
	return plannerStore.latestWeight;
}

/**
 * Ряд для графика.
 *
 * Дни без взвешивания остаются нулями и отбрасываются рисующим кодом:
 * соединять их прямой линией — значит показать снижение веса в дни,
 * когда человек на весы не вставал.
 */
export function weightSeries(end: DateKey, days: number): DayValue[] {
	const byDate = new Map(plannerStore.weightEntries.map((entry) => [entry.date, entry.weightKg]));
	return dateRange(end, days).map((date) => ({ date, value: byDate.get(date) ?? 0 }));
}

/**
 * Изменение веса за период: последнее взвешивание минус первое.
 *
 * null, когда сравнивать не с чем: одна точка — это не динамика, и рисовать
 * «−0,0 кг» по ней честнее не показывать вовсе.
 */
export function weightChange(end: DateKey, days: number): number | null {
	const measured = weightSeries(end, days).filter((day) => day.value > 0);
	if (measured.length < 2) return null;

	return Math.round((measured[measured.length - 1].value - measured[0].value) * 10) / 10;
}

/**
 * Разошёлся ли вес с анкетой.
 *
 * Цели считаются от веса, и анкета с прошлогодним весом тихо выдаёт цели,
 * к которым нет доверия. Предложение пересчитать появляется только когда
 * разница заметна.
 */
export function goalsOutOfDate(): boolean {
	const profile = plannerStore.doc.settings.profile;
	const latest = plannerStore.latestWeight;
	if (!profile || !latest) return false;

	return Math.abs(latest.weightKg - profile.weightKg) >= GOAL_REFRESH_THRESHOLD_KG;
}

/**
 * Пересчёт целей по последнему взвешиванию.
 *
 * Анкета остаётся прежней, меняется только вес: рост, возраст и уровень
 * активности спрашивать заново незачем.
 */
export function refreshGoalsFromWeight(): ServiceResult<null> {
	const profile = plannerStore.doc.settings.profile;
	const latest = plannerStore.latestWeight;

	if (!profile || !latest) {
		return { ok: false, errors: { profile: 'Сначала заполните анкету в настройках' } };
	}

	const result = saveProfile({ ...profile, weightKg: latest.weightKg });
	return result.ok ? { ok: true, value: null } : { ok: false, errors: result.errors };
}

export interface WeightProgress {
	goalKg: number;
	/** Сколько осталось до цели. Ноль и меньше — цель достигнута. */
	remainingKg: number;
	/** Скорость за последнюю неделю периода. null — измерений слишком мало. */
	perWeekKg: number | null;
	/** Ожидаемая дата при текущей скорости. null — обещать нечего. */
	etaDate: DateKey | null;
}

/**
 * Насколько далеко цель и когда она наступит при нынешнем темпе.
 *
 * Прогноз — самая соблазнительная возможность соврать, поэтому он выдаётся
 * только когда для него есть основания: минимум два взвешивания, разнесённые
 * хотя бы на неделю, и движение в сторону цели. Всё остальное — гадание
 * на одном килограмме, которое человек примет за обещание.
 *
 * Горизонт ограничен двумя годами: «вы придёте к цели в 2031 году» —
 * не прогноз, а насмешка.
 */
const MAX_FORECAST_DAYS = 730;
const MIN_TREND_DAYS = 7;
const MIN_WEEKLY_CHANGE_KG = 0.1;

export function weightProgress(end: DateKey, days: number): WeightProgress | null {
	const goalKg = plannerStore.doc.settings.weightGoalKg;
	const latest = plannerStore.latestWeight;

	if (!goalKg || !latest) return null;

	const remainingKg = Math.round((latest.weightKg - goalKg) * 10) / 10;
	const measured = weightSeries(end, days).filter((day) => day.value > 0);

	const progress: WeightProgress = {
		goalKg,
		remainingKg,
		perWeekKg: null,
		etaDate: null
	};

	if (measured.length < 2) return progress;

	const first = measured[0];
	const last = measured[measured.length - 1];
	const spanDays = Math.round(
		(Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / 86_400_000
	);

	if (spanDays < MIN_TREND_DAYS) return progress;

	const perWeekKg = Math.round(((last.value - first.value) / spanDays) * 7 * 100) / 100;
	progress.perWeekKg = perWeekKg;

	// Цель достигнута — прогнозировать нечего.
	if (Math.abs(remainingKg) < 0.1) return progress;

	// Движение должно идти в сторону цели: при обратном темпе честный ответ —
	// молчание, а не дата, до которой «осталось немного».
	const towardsGoal = remainingKg > 0 ? perWeekKg < 0 : perWeekKg > 0;
	if (!towardsGoal || Math.abs(perWeekKg) < MIN_WEEKLY_CHANGE_KG) return progress;

	const daysNeeded = Math.ceil((Math.abs(remainingKg) / Math.abs(perWeekKg)) * 7);
	if (daysNeeded > MAX_FORECAST_DAYS) return progress;

	progress.etaDate = addDays(last.date, daysNeeded);
	return progress;
}

/** Цель по весу. Ноль и пустое значение убирают её совсем. */
export function setWeightGoal(goalKg: number | null): ServiceResult<null> {
	if (goalKg === null || goalKg === 0) {
		plannerStore.updateSettings({ weightGoalKg: undefined });
		return { ok: true, value: null };
	}

	const errors = validateWeight(goalKg);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	plannerStore.updateSettings({ weightGoalKg: roundWeight(goalKg) });
	return { ok: true, value: null };
}
