<script lang="ts">
	import DashboardHeader from '$lib/components/dashboard/dashboard-header.svelte';
	import PlanWidget from '$lib/components/plan/plan-widget.svelte';
	import NutritionWidget from '$lib/components/dashboard/nutrition-widget.svelte';
	import FoodLogWidget from '$lib/components/dashboard/food-log-widget.svelte';
	import HabitsWidget from '$lib/components/dashboard/habits-widget.svelte';
	import FinanceWidget from '$lib/components/dashboard/finance-widget.svelte';
</script>

<DashboardHeader />

<div class="flex flex-col gap-4">
	<PlanWidget />
	<NutritionWidget />
	<FoodLogWidget />
	<HabitsWidget />
	<FinanceWidget />
</div>
