<script lang="ts">
	import { CaretRight, User } from 'phosphor-svelte';
	import ProfileAvatar from '$lib/components/brand/profile-avatar.svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { billing } from '$lib/state/billing.svelte';
	import { session } from '$lib/state/session.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { formatNumber, formatWeight } from '$lib/utils/format';

	type Props = { step?: number };
	let { step = 0 }: Props = $props();

	/**
	 * Имя берётся из ответа сервера, а если входа нет — из того, что
	 * уже лежит в документе: открытое вне Telegram приложение не должно
	 * называть человека «Гостем», если оно его помнит.
	 */
	const knownName = $derived(session.user?.firstName || plannerStore.doc.user.firstName || '');
	const name = $derived(knownName || 'Ваш профиль');
	const username = $derived(session.user?.username || plannerStore.doc.user.username);

	const nutrition = $derived(plannerStore.todayNutrition);
	const weightGoal = $derived(plannerStore.doc.settings.weightGoalKg);

	/**
	 * Одна строка целей — ответ на «что у меня стоит», не открывая экран.
	 * Вода в литрах: «2,5 л» короче и привычнее, чем «2 500 мл».
	 */
	const goalsLine = $derived.by(() => {
		const parts = [`${formatNumber(nutrition.calorieGoal)} ккал`];
		parts.push(`вода ${formatNumber(Math.round(nutrition.waterGoalMl / 100) / 10)} л`);
		if (weightGoal) parts.push(`цель ${formatWeight(weightGoal)} кг`);
		return parts.join(' · ');
	});

	/** Откуда данные: человеку важно знать, уедут ли они на другой телефон. */
	const accountLine = $derived.by(() => {
		switch (session.status) {
			case 'authenticated': {
				const via = session.kind === 'device' ? 'вход по коду из бота' : 'вход через Telegram';
				return username ? `@${username} · ${via}` : via[0].toUpperCase() + via.slice(1);
			}
			case 'authenticating':
				return 'Проверяем вход…';
			case 'error':
				return session.error ?? 'Не удалось войти';
			case 'signedOut':
				return 'Вход не выполнен';
			default:
				return 'Без входа: только на этом устройстве';
		}
	});

	const planLabel = $derived(billing.isPro ? 'Pro' : 'Бесплатно');
</script>

<!--
	Карточка-вход в профиль. Вся карточка — одна ссылка: у неё одна задача,
	а тариф дальше продублирован отдельной строкой списка, чтобы до него
	не надо было догадываться нажать на чип.
-->
<GlassCard href="/settings/profile" bezel class="fx-rise" style="--fx-step: {step}">
	<div class="flex items-center gap-3.5">
		<!--
			Без имени — нейтральный значок, а не «?» на градиенте:
			вопросительный знак выглядит как ошибка загрузки.
		-->
		{#if knownName}
			<ProfileAvatar name={knownName} size={44} />
		{:else}
			<span
				aria-hidden="true"
				class="grid size-11 shrink-0 place-items-center rounded-full bg-lavender/15 text-lavender"
			>
				<User size={20} weight="light" />
			</span>
		{/if}

		<span class="min-w-0 flex-1">
			<span class="flex items-center gap-2">
				<span class="truncate text-sm font-medium">{name}</span>
				<span
					class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium
					       {billing.isPro ? 'bg-lavender text-on-accent' : 'bg-ink/[0.06] text-muted-foreground'}"
				>
					{planLabel}
				</span>
			</span>
			<span class="tabular mt-0.5 block truncate text-xs text-muted-foreground">
				{goalsLine}
			</span>
			<span class="block truncate text-xs text-muted-foreground/70">
				{accountLine}
			</span>
		</span>

		<CaretRight size={14} weight="light" class="shrink-0 text-muted-foreground/70" />
	</div>
</GlassCard>
