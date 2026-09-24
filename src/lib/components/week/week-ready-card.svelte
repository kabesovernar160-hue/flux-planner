<script lang="ts">
	import { CaretRight, ChartBar } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { weekDataFromStore } from '$lib/services/weekService';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { getToday } from '$lib/utils/date';
	import { buildWeekReport, percent, readyWeekStart, weekLabel } from '$lib/utils/weekly';

	/**
	 * Вход в итоги недели с главной.
	 *
	 * Только по воскресеньям и понедельникам и только если неделе есть что
	 * подводить: карточка, которая висит всегда, перестаёт замечаться, а
	 * «итоги готовы» над пустой неделей — обещание, которое нечем выполнить.
	 */
	const today = $derived(getToday(plannerStore.doc.user.timezone));
	const start = $derived(readyWeekStart(today));
	const report = $derived(start ? buildWeekReport(weekDataFromStore(), start, today) : null);
	const habits = $derived(report ? percent(report.habits.rate) : null);
</script>

{#if start && report && !report.isEmpty}
	<div class="fx-rise mb-4" style="--fx-step: 0;">
		<GlassCard href="/week?start={start}" padding="sm">
			<span class="flex items-center gap-3">
				<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-lavender/12">
					<ChartBar size={17} weight="regular" class="text-lavender" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block text-sm font-medium">Итоги недели готовы</span>
					<!-- Одна цифра, а не пересказ: подробности — по нажатию. -->
					<span class="block truncate text-xs text-muted-foreground">
						{weekLabel(start)} · {habits !== null
							? `привычки ${habits} %`
							: `${report.activeDays} из 7 дней с записями`}
					</span>
				</span>
				<CaretRight size={14} weight="light" class="shrink-0 text-muted-foreground" />
			</span>
		</GlassCard>
	</div>
{/if}
