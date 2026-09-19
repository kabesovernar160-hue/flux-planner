<script lang="ts">
	type Props = {
		label: string;
		current: number;
		goal: number;
		unit: string;
		/**
		 * Ступень лавандового рампа, 0…3.
		 *
		 * Макросы намеренно не раскрашены в разные цвета: правило палитры —
		 * один акцент на экран. Родственные величины различаются
		 * насыщенностью одного тона, а не разными оттенками.
		 */
		tone?: 0 | 1 | 2 | 3;
	};

	let { label, current, goal, unit, tone = 0 }: Props = $props();

	const ratio = $derived(Math.min(1, Math.max(0, goal === 0 ? 0 : current / goal)));
	const opacity = $derived([1, 0.78, 0.58, 0.42][tone]);

	// Числа с дробной частью только там, где она есть: «1,4 л» но «82 г».
	const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

	let revealed = $state(false);
	$effect(() => {
		const id = requestAnimationFrame(() => (revealed = true));
		return () => cancelAnimationFrame(id);
	});
</script>

<div class="min-w-0">
	<div class="mb-1.5 flex items-baseline justify-between gap-1">
		<span class="truncate text-[11px] text-muted-foreground">{label}</span>
		<span class="tabular shrink-0 text-[11px] font-medium">
			{fmt(current)}<span class="text-muted-foreground">/{fmt(goal)} {unit}</span>
		</span>
	</div>

	<div class="h-1.5 overflow-hidden rounded-full bg-line">
		<!--
			Заполнение через transform: scaleX, а не через width.
			Ширина — свойство раскладки, её анимация заставляет браузер
			пересчитывать layout каждый кадр. transform идёт на GPU.
		-->
		<div
			class="h-full origin-left rounded-full bg-lavender"
			style="
				opacity: {opacity};
				transform: scaleX({revealed ? ratio : 0});
				transition: transform 0.9s var(--fx-ease);
			"
		></div>
	</div>
</div>
