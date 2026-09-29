<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		/** Доля заполнения, 0…1. */
		value: number;
		size?: number;
		stroke?: number;
		/** Красная дуга при превышении цели. */
		over?: boolean;
		children?: Snippet;
	};

	let { value, size = 176, stroke = 13, over = false, children }: Props = $props();

	// Уникальный id обязателен: при двух кольцах на экране одинаковые
	// id градиентов схлопнутся, и второе кольцо отрисуется цветом первого.
	const uid = $props.id();

	const radius = $derived((size - stroke) / 2);
	const circumference = $derived(2 * Math.PI * radius);
	const clamped = $derived(Math.min(1, Math.max(0, value)));

	// Кольцо разворачивается из нуля после монтирования: значение, появившееся
	// сразу целиком, читается как статичная картинка, а не как прогресс.
	let revealed = $state(false);
	$effect(() => {
		const id = requestAnimationFrame(() => (revealed = true));
		return () => cancelAnimationFrame(id);
	});

	const offset = $derived(revealed ? circumference * (1 - clamped) : circumference);
</script>

<div class="relative grid place-items-center" style="width: {size}px; height: {size}px;">
	<!--
		Мягкое свечение под дугой — в тоне карточки, а не всегда лавандовое:
		в янтарной плитке лавандовый ореол выдавал чужой раздел.
		Статичный радиальный градиент, не фильтр: blur здесь стоил бы
		перерисовки на каждом кадре анимации.
	-->
	<div
		class="pointer-events-none absolute inset-3 rounded-full"
		style="background: radial-gradient(circle, color-mix(in oklch, {over
			? 'var(--destructive)'
			: 'var(--fx-tone)'} 14%, transparent), transparent 68%);"
	></div>

	<svg
		width={size}
		height={size}
		viewBox="0 0 {size} {size}"
		class="absolute -rotate-90"
		aria-hidden="true"
	>
		<defs>
			<linearGradient id="ring-{uid}" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0%" stop-color="color-mix(in oklch, var(--fx-tone), black 14%)" />
				<stop offset="55%" stop-color="var(--fx-tone)" />
				<stop offset="100%" stop-color="color-mix(in oklch, var(--fx-tone), white 16%)" />
			</linearGradient>
		</defs>

		<circle
			cx={size / 2}
			cy={size / 2}
			r={radius}
			fill="none"
			stroke="var(--fx-line)"
			stroke-width={stroke}
		/>

		<!--
			Смещение задано через style, а не атрибутом: CSS-переход надёжно
			срабатывает на смену свойства, и кольцо дорастает до нового значения
			после каждой записи, а не перепрыгивает. 500 мс — верхняя граница
			движения по docs/design.md: дольше отдача начинает ощущаться задержкой.
		-->
		<circle
			cx={size / 2}
			cy={size / 2}
			r={radius}
			fill="none"
			stroke={over ? 'var(--destructive)' : `url(#ring-${uid})`}
			stroke-width={stroke}
			stroke-linecap="round"
			stroke-dasharray={circumference}
			style="stroke-dashoffset: {offset}px; transition: stroke-dashoffset 0.5s var(--fx-ease);"
		/>
	</svg>

	{#if children}
		<div class="relative z-10 flex flex-col items-center text-center">
			{@render children()}
		</div>
	{/if}
</div>
