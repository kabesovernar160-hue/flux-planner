<script lang="ts">
	import { CheckCircle, Wallet } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import ProgressRing from '$lib/components/ui/progress-ring.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { formatMoney, formatNumber } from '$lib/utils/format';

	/**
	 * «Сегодня коротко»: три плитки вместо повтора больших карточек ниже.
	 * Тап переносит к нужной карточке, а не дублирует её функциональность —
	 * второй кнопки «добавить воду» или «записать трату» здесь нет.
	 */

	const headline = $derived(
		plannerStore.isOverCalorieGoal
			? plannerStore.caloriesConsumed - plannerStore.todayNutrition.calorieGoal
			: plannerStore.caloriesRemaining
	);

	const habitsDone = $derived(plannerStore.completedHabits.length);
	const habitsTotal = $derived(plannerStore.todayHabits.length);

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
		class="row-span-2 flex flex-col justify-between"
	>
		<p class="text-[11px] text-muted-foreground">
			{plannerStore.isOverCalorieGoal ? 'Перебор' : 'Осталось ккал'}
		</p>

		<div class="mt-2 flex items-center gap-3">
			<ProgressRing
				value={plannerStore.calorieProgress}
				over={plannerStore.isOverCalorieGoal}
				size={60}
				stroke={6}
			/>
			<span class="tabular fx-num text-2xl leading-none font-semibold tracking-tighter">
				{formatNumber(headline)}
			</span>
		</div>
	</GlassCard>

	<GlassCard tone="mint" padding="sm" onclick={() => jump('habits-card')}>
		<div class="flex items-center gap-1.5">
			<CheckCircle size={13} weight="regular" class="text-tone" />
			<p class="text-[11px] text-muted-foreground">Привычки</p>
		</div>
		<p class="tabular fx-num mt-1.5 text-xl leading-none font-semibold tracking-tight">
			{habitsDone}<span class="text-sm font-normal text-muted-foreground">/{habitsTotal}</span>
		</p>
	</GlassCard>

	<GlassCard tone="sky" padding="sm" onclick={() => jump('finance-card')}>
		<div class="flex items-center gap-1.5">
			<Wallet size={13} weight="regular" class="text-tone" />
			<p class="text-[11px] text-muted-foreground">Траты сегодня</p>
		</div>
		<p class="tabular fx-num mt-1.5 text-xl leading-none font-semibold tracking-tight">
			{money(plannerStore.dailySpent)}
		</p>
		<p class="tabular mt-0.5 text-[10px] text-muted-foreground">
			лимит {money(plannerStore.todayFinance.budget)}
		</p>
	</GlassCard>
</div>
