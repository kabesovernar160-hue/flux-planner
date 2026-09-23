<script lang="ts">
	import DashboardHeader from '$lib/components/dashboard/dashboard-header.svelte';
	import DashboardBento from '$lib/components/dashboard/dashboard-bento.svelte';
	import PlanWidget from '$lib/components/plan/plan-widget.svelte';
	import NutritionWidget from '$lib/components/dashboard/nutrition-widget.svelte';
	import HabitsWidget from '$lib/components/dashboard/habits-widget.svelte';
	import FinanceWidget from '$lib/components/dashboard/finance-widget.svelte';
</script>

<!--
	Лесенка появления: шапка первой, дальше плитки и карточки сверху вниз.
	Номер шага — не индекс в цикле, а положение на экране: порядок
	виджетов задан здесь руками, и лесенка обязана совпадать с ним.
-->
<div class="fx-rise" style="--fx-step: 0;">
	<DashboardHeader />
</div>

<div class="fx-rise mb-4" style="--fx-step: 1;">
	<DashboardBento />
</div>

<div class="flex flex-col gap-4">
	<div class="fx-rise" style="--fx-step: 2;"><PlanWidget /></div>
	<div class="fx-rise" style="--fx-step: 3;"><NutritionWidget /></div>
	<div class="fx-rise" style="--fx-step: 4;"><HabitsWidget /></div>
	<div class="fx-rise" style="--fx-step: 5;"><FinanceWidget /></div>
</div>
