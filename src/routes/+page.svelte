<script lang="ts">
	import WeekReadyCard from '$lib/components/week/week-ready-card.svelte';
	import DashboardHeader from '$lib/components/dashboard/dashboard-header.svelte';
	import DashboardBento from '$lib/components/dashboard/dashboard-bento.svelte';
	import PlanWidget from '$lib/components/plan/plan-widget.svelte';
	import NutritionWidget from '$lib/components/dashboard/nutrition-widget.svelte';
	import HabitsWidget from '$lib/components/dashboard/habits-widget.svelte';
	import FinanceWidget from '$lib/components/dashboard/finance-widget.svelte';
	import FirstPraise from '$lib/components/first-run/first-praise.svelte';
	import StartActions from '$lib/components/first-run/start-actions.svelte';
	import { firstRun } from '$lib/state/firstRun.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { nowIso } from '$lib/utils/date';
	import { hasAnyRecords, hasRecordSince } from '$lib/utils/firstRun';

	const hasRecords = $derived(hasAnyRecords(plannerStore));

	/**
	 * Пустая главная.
	 *
	 * Пять карточек с нулями ничему не учат: человек видит «0 из 0»
	 * и не понимает, с чего начать. Вместо них — три действия, каждое
	 * из которых за один-два тапа даёт первую запись.
	 */
	const blank = $derived(firstRun.settled && !hasRecords);

	$effect(() => {
		if (blank && firstRun.emptySince === null) firstRun.emptySince = nowIso();
	});

	/**
	 * Похвала за первую запись.
	 *
	 * Только если запись сделана после показа пустой главной: данные,
	 * приехавшие синхронизацией, — не действие человека, и хвалить за них
	 * было бы странно.
	 */
	const praise = $derived(
		hasRecords &&
			firstRun.emptySince !== null &&
			!firstRun.praiseDismissed &&
			hasRecordSince(plannerStore, firstRun.emptySince)
	);
</script>

<WeekReadyCard />

<!--
	Лесенка появления: шапка первой, дальше плитки и карточки сверху вниз.
	Номер шага — не индекс в цикле, а положение на экране: порядок
	виджетов задан здесь руками, и лесенка обязана совпадать с ним.
-->
<div class="fx-rise" style="--fx-step: 0;">
	<DashboardHeader />
</div>

{#if hasRecords}
	{#if praise}
		<FirstPraise onclose={() => (firstRun.praiseDismissed = true)} />
	{/if}

	<div class="fx-rise mb-4" style="--fx-step: 1;">
		<DashboardBento />
	</div>

	<div class="flex flex-col gap-4">
		<div class="fx-rise" style="--fx-step: 2;"><PlanWidget /></div>
		<div class="fx-rise" style="--fx-step: 3;"><NutritionWidget /></div>
		<div class="fx-rise" style="--fx-step: 4;"><HabitsWidget /></div>
		<div class="fx-rise" style="--fx-step: 5;"><FinanceWidget /></div>
	</div>
{:else if blank}
	<section aria-labelledby="start-title">
		<div class="fx-rise mb-4" style="--fx-step: 1;">
			<h2 id="start-title" class="text-xl font-semibold tracking-tight">Начни с одного</h2>
			<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
				Одна запись — и день начнёт складываться в картину.
			</p>
		</div>

		<StartActions step={2} />
	</section>
{/if}
