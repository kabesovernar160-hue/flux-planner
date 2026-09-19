import { plannerStore } from '$lib/stores/plannerStore.svelte';
import type { UserProfile } from '$lib/types/planner';
import { nowIso } from '$lib/utils/date';
import {
	calculateGoals,
	validateProfile,
	type GoalSuggestion,
	type ProfileInput
} from '$lib/utils/goals';
import type { ServiceResult } from './nutritionService';

/**
 * Анкета и пересчёт целей.
 *
 * Цели пишутся сразу в два места: в настройки (шаблон для будущих дней)
 * и в запись текущего дня, если она уже создана. Иначе человек заполнил бы
 * анкету и не увидел бы никакой разницы на главной — запись дня осталась бы
 * со старыми значениями.
 */
export function saveProfile(input: ProfileInput): ServiceResult<GoalSuggestion> {
	const errors = validateProfile(input);
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	const goals = calculateGoals(input);
	const profile: UserProfile = { ...input, updatedAt: nowIso() };

	plannerStore.updateSettings({
		profile,
		onboardedAt: plannerStore.doc.settings.onboardedAt ?? nowIso(),
		calorieGoal: goals.calorieGoal,
		proteinGoal: goals.proteinGoal,
		fatGoal: goals.fatGoal,
		carbsGoal: goals.carbsGoal,
		waterGoalMl: goals.waterGoalMl
	});

	plannerStore.setCalorieGoal(goals.calorieGoal);
	plannerStore.setMacroGoals({
		proteinGoal: goals.proteinGoal,
		fatGoal: goals.fatGoal,
		carbsGoal: goals.carbsGoal
	});
	plannerStore.setWaterGoal(goals.waterGoalMl);

	return { ok: true, value: goals };
}

/** Пропуск анкеты. Цели остаются прежними, приветствие больше не показывается. */
export function skipOnboarding(): void {
	plannerStore.updateSettings({ onboardedAt: nowIso() });
}

export function needsOnboarding(): boolean {
	return !plannerStore.doc.settings.onboardedAt;
}

export function getProfile(): UserProfile | null {
	return plannerStore.doc.settings.profile ?? null;
}
