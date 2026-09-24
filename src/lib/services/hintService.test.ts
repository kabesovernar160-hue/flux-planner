import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, loadPlannerState } from '$lib/db/localDb';
import { resetDriverForTests } from '$lib/db/storage';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { isHintSeen, markHintSeen } from './hintService';

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();
	await plannerStore.reset();
});

describe('подсказки', () => {
	it('новая подсказка ещё не показана', () => {
		expect(isHintSeen('createButton')).toBe(false);
	});

	it('отметка сохраняется в настройки и двигает их отметку времени', async () => {
		const before = plannerStore.doc.settingsUpdatedAt;

		markHintSeen('createButton');
		await plannerStore.flush();

		expect(isHintSeen('createButton')).toBe(true);
		// Без сдвинутой отметки синхронизация сочла бы настройки прежними
		// и не отправила бы их на другое устройство.
		expect(plannerStore.doc.settingsUpdatedAt > before).toBe(true);

		const stored = await loadPlannerState(plannerStore.doc.user.timezone);
		expect(stored.settings.hints?.createButton).toBeTypeOf('string');
	});

	it('повторная отметка не переписывает время первого показа', () => {
		markHintSeen('createButton');
		const first = plannerStore.doc.settings.hints?.createButton;
		const stamp = plannerStore.doc.settingsUpdatedAt;

		markHintSeen('createButton');

		expect(plannerStore.doc.settings.hints?.createButton).toBe(first);
		expect(plannerStore.doc.settingsUpdatedAt).toBe(stamp);
	});
});
