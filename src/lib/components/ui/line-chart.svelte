<script lang="ts">
	import type { DayValue } from '$lib/utils/analytics';

	/**
	 * Линия по дням.
	 *
	 * Столбцы от нуля для веса не годятся: разница между 78 и 79 килограммами
	 * на такой шкале неразличима, а именно она и интересует. Здесь шкала
	 * строится по размаху самих значений, поэтому видно движение, а не рост
	 * от нуля.
	 *
	 * Дни без измерения пропускаются, а не считаются нулём: соединять их
	 * с нулём значило бы нарисовать обвал веса в дни, когда человек просто
	 * не встал на весы.
	 */

	type Props = {
		values: DayValue[];
		height?: number;
		/** Подпись под крайними точками. */
		format?: (value: number) => string;
	};

	let { values, height = 110, format = (value: number) => String(value) }: Props = $props();

	const WIDTH = 320;
	/** Поля сверху и снизу: иначе крайние точки срезаются рамкой. */
	const PADDING = 10;

	const points = $derived(
		values
			.map((day, index) => ({ ...day, index }))
			.filter((day) => Number.isFinite(day.value) && day.value > 0)
	);

	const low = $derived(Math.min(...points.map((point) => point.value)));
	const high = $derived(Math.max(...points.map((point) => point.value)));

	/**
	 * Размах шкалы.
	 *
	 * Минимум в один килограмм: на ровном весе линия иначе превращается
	 * в пилу из округлений — визуальный шум вместо «ничего не изменилось».
	 */
	const span = $derived(Math.max(high - low, 1));

	const coords = $derived(
		points.map((point) => ({
			date: point.date,
			value: point.value,
			x: values.length > 1 ? (point.index / (values.length - 1)) * WIDTH : WIDTH / 2,
			y: PADDING + (1 - (point.value - low) / span) * (height - PADDING * 2)
		}))
	);

	const path = $derived(
		coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ')
	);
</script>

{#if coords.length === 0}
	<p class="py-2 text-sm text-muted-foreground">Взвешиваний за период нет.</p>
{:else}
	<div>
		<svg
			viewBox="0 0 {WIDTH} {height}"
			preserveAspectRatio="none"
			class="w-full"
			style="height: {height}px"
			role="img"
			aria-label="График веса по дням"
		>
			{#if coords.length > 1}
				<path
					d={path}
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					vector-effect="non-scaling-stroke"
					class="text-tone"
				/>
			{/if}

			{#each coords as point (point.date)}
				<circle cx={point.x} cy={point.y} r="3" class="fill-tone" />
			{/each}
		</svg>

		<!--
			Подписи именованы: крайние значения шкалы лежат не слева и справа,
			а где придётся, и голые числа по краям читались бы как «начало»
			и «конец» периода.
		-->
		<div class="mt-1 flex justify-between text-[10px] text-muted-foreground">
			<span class="tabular">мин {format(low)}</span>
			<span class="tabular">макс {format(high)}</span>
		</div>
	</div>
{/if}
