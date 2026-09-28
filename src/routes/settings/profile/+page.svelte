<script lang="ts">
	import { Drop, Plus, Scales, Sparkle } from 'phosphor-svelte';
	import OnboardingFlow from '$lib/components/onboarding/onboarding-flow.svelte';
	import { commitInteger } from '$lib/components/settings/commit';
	import SettingsField from '$lib/components/settings/settings-field.svelte';
	import SettingsGroup from '$lib/components/settings/settings-group.svelte';
	import SettingsRow from '$lib/components/settings/settings-row.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { setWeightGoal } from '$lib/services/weightService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { GOAL_LABELS } from '$lib/utils/goals';
	import { formatNumber, formatWeight } from '$lib/utils/format';

	const nutrition = $derived(plannerStore.todayNutrition);
	const profile = $derived(plannerStore.doc.settings.profile);

	/**
	 * Цель меняется и в настройках, и в записи текущего дня.
	 *
	 * Настройки — это шаблон для дней без собственной записи. Если у сегодня
	 * запись уже есть, правка одних настроек не отразилась бы на экране,
	 * и человек решил бы, что поле не работает.
	 */
	function setCalories(value: number) {
		plannerStore.updateSettings({ calorieGoal: value });
		plannerStore.setCalorieGoal(value);
	}

	function setMacro(key: 'proteinGoal' | 'fatGoal' | 'carbsGoal', value: number) {
		plannerStore.updateSettings({ [key]: value });
		plannerStore.setMacroGoals({ [key]: value });
	}

	function setWater(value: number) {
		plannerStore.updateSettings({ waterGoalMl: value });
		plannerStore.setWaterGoal(value);
	}

	/**
	 * Цель по весу вводится с десятыми, а не целым числом.
	 *
	 * Общий commitInteger() округляет до целого — для калорий это правильно,
	 * для веса нет: между 75 и 75,5 килограммами разница, ради которой
	 * цель и ставят. Пустое поле снимает цель совсем.
	 */
	function commitWeightGoal(raw: string) {
		const text = raw.trim().replace(',', '.');

		if (text === '') {
			setWeightGoal(null);
			return;
		}

		const parsed = Number(text);
		if (!Number.isFinite(parsed)) return;

		if (setWeightGoal(parsed).ok) telegram.haptic.impact('light');
		else telegram.haptic.notification('error');
	}

	/** Анкета открывается повторно: вес меняется, и цели должны меняться с ним. */
	let recalculating = $state(false);

	const profileSummary = $derived.by(() => {
		if (!profile) return 'Анкета не заполнена — цели стоят по умолчанию';
		const goal = GOAL_LABELS[profile.goal].title.toLowerCase();
		return `${profile.weightKg} кг · ${profile.heightCm} см · ${profile.age} лет · ${goal}`;
	});

	const latestWeightLabel = $derived(
		plannerStore.latestWeight
			? `Последнее взвешивание: ${formatWeight(plannerStore.latestWeight.weightKg)} кг, ${plannerStore.latestWeight.date}`
			: 'Взвешиваний пока нет'
	);
</script>

<svelte:head>
	<title>Профиль и цели — Flux Planner</title>
</svelte:head>

{#if recalculating}
	<OnboardingFlow onclose={() => (recalculating = false)} />
{/if}

<PageHeader
	title="Профиль и цели"
	subtitle="Действуют на сегодня и все следующие дни"
	back="/settings"
/>

<div class="flex flex-col gap-4">
	<!--
		Анкета — первой: посчитать цели по себе быстрее и точнее, чем
		подбирать четыре числа вручную. Поля ниже — для тех, кто знает свои.
	-->
	<SettingsGroup tone="amber" step={0}>
		<SettingsRow
			icon={Sparkle}
			tone="amber"
			label="Посчитать под себя"
			hint={profileSummary}
			chevron
			onclick={() => {
				telegram.haptic.impact('light');
				recalculating = true;
			}}
		/>
	</SettingsGroup>

	<SettingsGroup title="Калории и БЖУ" tone="amber" step={1}>
		<SettingsField
			id="goal-calories"
			label="Калории"
			value={formatNumber(nutrition.calorieGoal)}
			unit="ккал"
			oncommit={(raw) => commitInteger(raw, setCalories)}
		/>
		<SettingsField
			id="goal-protein"
			label="Белки"
			value={formatNumber(nutrition.proteinGoal)}
			unit="г"
			oncommit={(raw) => commitInteger(raw, (value) => setMacro('proteinGoal', value))}
		/>
		<SettingsField
			id="goal-fat"
			label="Жиры"
			value={formatNumber(nutrition.fatGoal)}
			unit="г"
			oncommit={(raw) => commitInteger(raw, (value) => setMacro('fatGoal', value))}
		/>
		<SettingsField
			id="goal-carbs"
			label="Углеводы"
			value={formatNumber(nutrition.carbsGoal)}
			unit="г"
			oncommit={(raw) => commitInteger(raw, (value) => setMacro('carbsGoal', value))}
		/>
	</SettingsGroup>

	<!--
		Цель по весу необязательна: дневник полезен и без неё, а навязанная
		цифра превращает его в укор. Пустое поле снимает цель.
	-->
	<SettingsGroup
		title="Вода и вес"
		tone="amber"
		step={2}
		footer="Оставьте цель по весу пустой, если она не нужна."
	>
		<SettingsField
			id="goal-water"
			icon={Drop}
			label="Вода, норма"
			value={formatNumber(nutrition.waterGoalMl)}
			unit="мл"
			oncommit={(raw) => commitInteger(raw, setWater)}
		/>
		<SettingsField
			id="goal-weight"
			icon={Scales}
			label="Вес, цель"
			value={plannerStore.doc.settings.weightGoalKg
				? formatWeight(plannerStore.doc.settings.weightGoalKg)
				: ''}
			unit="кг"
			placeholder="нет"
			inputmode="decimal"
			oncommit={commitWeightGoal}
		/>
		<SettingsRow
			icon={Plus}
			tone="amber"
			label="Записать вес"
			hint={latestWeightLabel}
			onclick={() => ui.openWeightSheet()}
		/>
	</SettingsGroup>
</div>
