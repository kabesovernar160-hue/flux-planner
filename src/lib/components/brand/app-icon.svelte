<script lang="ts">
	type Props = {
		size?: number;
		class?: string;
	};

	let { size = 44, class: className = '' }: Props = $props();

	const PRIMARY = '/app-icon.png';
	const FALLBACK = '/favicon.svg';

	// static/app-icon.png — растровая марка приложения. Векторный favicon
	// остаётся фолбэком: без него каждое открытие приложения заканчивалось
	// запросом за несуществующим файлом и ошибкой 404 в журнале.
	// Флаг нужен, чтобы не уйти в цикл, если не загрузится и фолбэк.
	let src = $state(PRIMARY);
	let fellBack = $state(false);

	function handleError() {
		if (fellBack) return;
		fellBack = true;
		src = FALLBACK;
	}
</script>

<img
	{src}
	onerror={handleError}
	alt="Flux Planner"
	width={size}
	height={size}
	draggable="false"
	decoding="async"
	class="shrink-0 rounded-2xl border border-primary/30 object-cover select-none {className}"
	style="
		width: {size}px;
		height: {size}px;
		box-shadow: 0 0 22px -2px oklch(0.7022 0.1527 293.82 / 0.2);
	"
/>
