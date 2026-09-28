<script lang="ts">
	type Props = {
		/** Значения по дням, последний элемент — сегодня. */
		values: number[];
		/** Дневной лимит. Рисуется пунктиром, сразу видно дни с превышением. */
		limit?: number;
		height?: number;
		width?: number;
	};

	let { values, limit, height = 52, width = 132 }: Props = $props();

	const GAP = 5;

	const barWidth = $derived((width - GAP * (values.length - 1)) / values.length);
	// Шкалу задаёт не только максимум трат, но и лимит — иначе при спокойной
	// неделе пунктир лимита уезжает за верхний край графика.
	const peak = $derived(Math.max(...values, limit ?? 0) || 1);
	const limitY = $derived(limit ? height - (limit / peak) * height : null);

	let revealed = $state(false);
	$effect(() => {
		const id = requestAnimationFrame(() => (revealed = true));
		return () => cancelAnimationFrame(id);
	});
</script>

<svg
	viewBox="0 0 {width} {height}"
	{width}
	{height}
	role="img"
	aria-label="Траты за последние {values.length} дней"
	class="overflow-visible"
>
	{#each values as value, i (i)}
		{@const isToday = i === values.length - 1}
		{@const barHeight = Math.max(3, (value / peak) * height)}
		{@const x = i * (barWidth + GAP)}
		<rect
			{x}
			y={height - barHeight}
			width={barWidth}
			height={barHeight}
			rx={barWidth / 2}
			fill={isToday ? 'var(--fx-tone)' : 'var(--fx-line-strong)'}
			style="
				transform-origin: 50% {height}px;
				transform: scaleY({revealed ? 1 : 0});
				transition: transform 0.5s var(--fx-ease) {40 + i * 30}ms;
			"
		/>
	{/each}

	{#if limitY !== null}
		<line
			x1="0"
			y1={limitY}
			x2={width}
			y2={limitY}
			stroke="var(--fx-text-dim)"
			stroke-width="1"
			stroke-dasharray="2 4"
			opacity="0.45"
		/>
	{/if}
</svg>
