<script lang="ts">
	import { weekScore, type HabitWeekDay } from '$lib/utils/habitWeek';

	type Props = {
		week: HabitWeekDay[];
	};

	let { week }: Props = $props();

	const score = $derived(weekScore(week));

	/** Короткие подписи дней недели: 0 — воскресенье, как в Date.getUTCDay(). */
	const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

	function weekdayOf(date: string): string {
		const [year, month, day] = date.split('-').map(Number);
		return WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
	}

	const STATE_TITLE: Record<HabitWeekDay['state'], string> = {
		done: 'выполнено',
		missed: 'пропуск',
		pending: 'ещё можно отметить',
		rest: 'не по расписанию'
	};
</script>

<!--
	Семь точек за скользящую неделю, сегодня — справа.

	Четыре состояния читаются без легенды по «весу» точки: заполненная —
	сделано, бледная — пропуск, кольцо — день ещё идёт, крошечная — дня
	в расписании не было. Пропуск намеренно не красный: это история,
	а не упрёк, и красная россыпь на экране привычек отбивала бы охоту.
-->
<span
	role="img"
	aria-label="За неделю: {score.done} из {score.planned}"
	class="flex items-center gap-1.5"
>
	{#each week as day (day.date)}
		<span
			title="{weekdayOf(day.date)} — {STATE_TITLE[day.state]}"
			class="grid size-2 place-items-center"
		>
			{#if day.state === 'done'}
				<span class="size-2 rounded-full bg-tone"></span>
			{:else if day.state === 'missed'}
				<span class="size-2 rounded-full bg-tone/18"></span>
			{:else if day.state === 'pending'}
				<span class="size-2 rounded-full border border-tone/70"></span>
			{:else}
				<span class="size-1 rounded-full bg-muted-foreground/30"></span>
			{/if}
		</span>
	{/each}
</span>
