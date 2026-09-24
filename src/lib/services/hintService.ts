import { plannerStore } from '$lib/stores/plannerStore.svelte';
import type { HintId } from '$lib/types/planner';
import { nowIso } from '$lib/utils/date';

/**
 * Одноразовые подсказки.
 *
 * Отметка пишется в настройки и уезжает в синхронизацию вместе с ними,
 * поэтому подсказка, увиденная на одном устройстве, не всплывает на другом.
 */
export function isHintSeen(id: HintId): boolean {
	return Boolean(plannerStore.doc.settings.hints?.[id]);
}

/** Повторная отметка ничего не меняет: время первого показа не переписывается. */
export function markHintSeen(id: HintId): void {
	if (isHintSeen(id)) return;

	plannerStore.updateSettings({
		hints: { ...plannerStore.doc.settings.hints, [id]: nowIso() }
	});
}
