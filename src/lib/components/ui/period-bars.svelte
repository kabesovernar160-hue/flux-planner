<script lang="ts">
	import type { DayValue } from '$lib/utils/analytics';

	type Props = {
		values: DayValue[];
		/** Цель или лимит. Рисуется пунктиром — сразу видно дни с превышением. */
		goal?: number;
		/** Подписи под столбцами. При 30 днях их не влезает — отключается. */
		labels?: boolean;
		height?: number;
		/** Столбцы выше цели красятся тревожным цветом. */
		warnOverGoal?: boolean;
	};

	let { values, goal, labels = true, height = 120, warnOverGoal = false }: Props = $props();

	/**
	 * Ширина в единицах viewBox, а не в пикселях.
	 *
	 * SVG растягивается по контейнеру, поэтому график одинаково выглядит
	 * и на 320 px, и в широком окне десктопного Telegram, не пересчитываясь
	 * при каждом изменении размера.
	 */
	const WIDTH = 320;

	const gap = $derived(values.length > 14 ? 2 : 6);
	const barWidth = $derived(Math.max(1, (WIDTH - gap * (values.length - 1)) / values.length));

	// Шкалу задаёт и цель тоже: иначе на спокойной неделе пунктир уезжает
	// за верхний край.
	const peak = $derived(Math.max(...values.map((day) => day.value), goal ?? 0) || 1);
	const goalY = $derived(goal ? height - (goal / peak) * height : null);

	const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

	function weekday(date: string): string {
		const [year, month, day] = date.split('-').map(Number);
		return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
	}

	// Столбцы вырастают после монтирования: значения, появившиеся сразу
	// целиком, читаются как картинка, а не как данные.
	let revealed = $state(false);
	$effect(() => {
		const id = requestAnimationFrame(() => (revealed = true));
		return () => cancelAnimationFrame(id);
	});
</script>

<div>
	<svg
		viewBox="0 0 {WIDTH} {height}"
		preserveAspectRatio="none"
		class="w-full"
		style="height: {height}px"
		role="img"
		aria-label="График по дням"
	>
		{#each values as day, index (day.date)}
			{@const barHeight = Math.max(day.value > 0 ? 2 : 0, (day.value / peak) * height)}
			{@const over = warnOverGoal && goal !== undefined && day.value > goal}
			<rect
				x={index * (barWidth + gap)}
				y={height - (revealed ? barHeight : 0)}
				width={barWidth}
				height={revealed ? barHeight : 0}
				rx={Math.min(3, barWidth / 2)}
				class={over ? 'fill-destructive/80' : 'fill-lavender/85'}
				style="transition: y 0.7s var(--fx-ease) {index * 18}ms, height 0.7s var(--fx-ease) {index *
					18}ms;"
			/>
		{/each}

		{#if goalY !== null}
			<line
				x1="0"
				x2={WIDTH}
				y1={goalY}
				y2={goalY}
				stroke="currentColor"
				stroke-width="1"
				stroke-dasharray="4 4"
				class="text-muted-foreground/50"
			/>
		{/if}
	</svg>

	{#if labels}
		<div class="mt-1.5 flex" style="gap: {gap}px">
			{#each values as day (day.date)}
				<span class="flex-1 text-center text-[9px] text-muted-foreground">
					{weekday(day.date)}
				</span>
			{/each}
		</div>
	{/if}
</div>
