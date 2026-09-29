<script lang="ts">
	import { CheckCircle, Wallet } from 'phosphor-svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import ProgressRing from '$lib/components/ui/progress-ring.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { formatMoney, formatNumber } from '$lib/utils/format';

	/**
	 * «Сегодня коротко» — единственное место на главной, где живут большие
	 * цифры дня. Карточки ниже их не повторяют: там статус и действие.
	 * Тап по плитке переносит к карточке раздела, а не дублирует её кнопки.
	 */

	const headline = $derived(
		plannerStore.isOverCalorieGoal
			? plannerStore.caloriesConsumed - plannerStore.todayNutrition.calorieGoal
			: plannerStore.caloriesRemaining
	);

	/**
	 * Число в кольце доезжает до нового значения вместе с дугой.
	 * Если дуга плавно растёт, а цифра перескакивает сразу, глаз видит
	 * два разных события вместо одного. Длительность та же, что у дуги.
	 */
	const shownHeadline = Tween.of(() => headline, {
		duration: () => (prefersReducedMotion.current ? 0 : 500),
		easing: cubicOut
	});

	const habitsDone = $derived(plannerStore.completedHabits.length);
	const habitsTotal = $derived(plannerStore.todayHabits.length);

	/**
	 * Отрезки по одному на привычку, пока их немного: «4 из 6» считывается
	 * без чтения цифр. Больше восьми отрезков сливаются в полосу — тогда
	 * честнее показать обычную полосу.
	 */
	const segmented = $derived(habitsTotal > 0 && habitsTotal <= 8);

	const currency = $derived(plannerStore.doc.settings.currency);
	const locale = $derived(plannerStore.doc.settings.locale);
	const money = (value: number) => formatMoney(value, currency, locale);

	function jump(id: string) {
		telegram.haptic.impact('light');
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<div class="grid grid-cols-2 grid-rows-2 gap-3">
	<GlassCard
		tone="amber"
		padding="sm"
		onclick={() => jump('nutrition-card')}
		aria-label="Калории: {plannerStore.isOverCalorieGoal ? 'перебор' : 'осталось'} {formatNumber(
			headline
		)} из {formatNumber(plannerStore.todayNutrition.calorieGoal)}"
		class="row-span-2"
	>
		<p class="text-xs text-muted-foreground">
			{plannerStore.isOverCalorieGoal ? 'Перебор, ккал' : 'Осталось ккал'}
		</p>

		<!-- Число внутри кольца: пустое кольцо рядом с цифрой читалось как недорисованное. -->
		<div class="mt-2.5 grid place-items-center">
			<ProgressRing
				value={plannerStore.calorieProgress}
				over={plannerStore.isOverCalorieGoal}
				size={136}
				stroke={9}
			>
				<span
					class="fx-num text-3xl leading-none {plannerStore.isOverCalorieGoal
						? 'text-destructive'
						: ''}"
				>
					{formatNumber(Math.round(shownHeadline.current))}
				</span>
				<span class="tabular mt-1.5 text-[11px] text-muted-foreground">
					из {formatNumber(plannerStore.todayNutrition.calorieGoal)}
				</span>
			</ProgressRing>
		</div>
	</GlassCard>

	<GlassCard
		tone="mint"
		padding="sm"
		onclick={() => jump('habits-card')}
		aria-label="Привычки: {habitsDone} из {habitsTotal}"
	>
		<span class="flex items-center gap-1.5">
			<CheckCircle size={14} weight="regular" class="text-tone" />
			<span class="text-xs text-muted-foreground">Привычки</span>
		</span>

		<span class="mt-2 block">
			<span class="fx-num block text-3xl leading-none">
				{habitsDone}<span class="text-base font-normal text-muted-foreground">/{habitsTotal}</span>
			</span>

			<!-- Отдельные отрезки вместо полосы: видно, сколько осталось, а не только долю. -->
			{#if segmented}
				<span class="mt-2.5 flex gap-1" aria-hidden="true">
					{#each { length: habitsTotal }, index (index)}
						<span
							class="h-1 flex-1 rounded-full transition-colors duration-500 ease-flux
							       {index < habitsDone ? 'bg-tone' : 'bg-line'}"
						></span>
					{/each}
				</span>
			{:else}
				<span class="mt-2.5 block h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
					<span
						class="block h-full origin-left rounded-full bg-tone transition-transform duration-500 ease-flux"
						style="transform: scaleX({plannerStore.habitCompletionProgress});"
					></span>
				</span>
			{/if}
		</span>
	</GlassCard>

	<GlassCard
		tone="sky"
		padding="sm"
		onclick={() => jump('finance-card')}
		aria-label="Траты сегодня: {money(plannerStore.dailySpent)} из {money(
			plannerStore.todayFinance.budget
		)}"
	>
		<span class="flex items-center gap-1.5">
			<Wallet size={14} weight="regular" class="text-tone" />
			<span class="text-xs text-muted-foreground">Траты сегодня</span>
		</span>

		<span class="mt-2 block">
			<span
				class="fx-num block truncate text-3xl leading-none {plannerStore.isOverBudget
					? 'text-destructive'
					: ''}"
			>
				{money(plannerStore.dailySpent)}
			</span>
			<span class="tabular mt-1.5 block truncate text-[11px] text-muted-foreground">
				из {money(plannerStore.todayFinance.budget)}
			</span>
		</span>
	</GlassCard>
</div>
