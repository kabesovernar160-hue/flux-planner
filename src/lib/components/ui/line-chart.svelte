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
		/** Высота поля графика в пикселях, без подписей дат. */
		height?: number;
		/** Подпись значений шкалы и последней точки. */
		format?: (value: number) => string;
		/** Цель. Рисуется пунктиром, если лежит недалеко от линии. */
		goal?: number | null;
		/** Что это за график — для скринридера. */
		label?: string;
	};

	let {
		values,
		height = 110,
		format = (value: number) => String(value),
		goal = null,
		label = 'График веса по дням'
	}: Props = $props();

	const uid = $props.id();

	let width = $state(0);
	const W = $derived(width || 300);
	/** Поле справа под подписи шкалы. */
	const GUTTER = 40;
	/** Поля сверху и снизу: иначе крайние точки срезаются рамкой. */
	const PAD = 12;

	const plotWidth = $derived(W - GUTTER);

	const points = $derived(
		values
			.map((day, index) => ({ ...day, index }))
			.filter((day) => Number.isFinite(day.value) && day.value > 0)
	);

	const low = $derived(Math.min(...points.map((point) => point.value)));
	const high = $derived(Math.max(...points.map((point) => point.value)));

	/**
	 * Цель входит в шкалу, только если она рядом.
	 *
	 * Цель в десяти килограммах от текущего веса сплющила бы всю линию
	 * в ровную полосу у края — движение за месяц перестало бы читаться.
	 * Далёкая цель остаётся в тексте под графиком.
	 */
	const goalInView = $derived(
		goal !== null &&
			goal > 0 &&
			points.length > 0 &&
			goal >= low - Math.max(high - low, 1) * 1.5 &&
			goal <= high + Math.max(high - low, 1) * 1.5
	);

	const domainLow = $derived(goalInView && goal !== null ? Math.min(low, goal) : low);
	const domainHigh = $derived(goalInView && goal !== null ? Math.max(high, goal) : high);

	/**
	 * Размах шкалы.
	 *
	 * Минимум в один килограмм: на ровном весе линия иначе превращается
	 * в пилу из округлений — визуальный шум вместо «ничего не изменилось».
	 */
	const span = $derived(Math.max(domainHigh - domainLow, 1));
	const mid = $derived((domainHigh + domainLow) / 2);
	const yOf = (value: number) => PAD + (0.5 - (value - mid) / span) * (height - PAD * 2);

	const coords = $derived(
		points.map((point) => ({
			date: point.date,
			value: point.value,
			x: values.length > 1 ? (point.index / (values.length - 1)) * plotWidth : plotWidth / 2,
			y: yOf(point.value)
		}))
	);

	/**
	 * Монотонная кривая (Фрич — Карлсон).
	 *
	 * Ломаная между редкими взвешиваниями выглядит тревожнее, чем вес на
	 * самом деле менялся, а обычная сглаженная кривая «перелетает» точки
	 * и рисует минимумы, которых не было. Монотонная проходит через каждую
	 * точку и не выходит за соседние значения.
	 */
	function curve(list: { x: number; y: number }[]): string {
		if (list.length === 0) return '';
		if (list.length === 1) return `M${list[0].x} ${list[0].y}`;

		const n = list.length;
		const slopes: number[] = [];
		for (let i = 0; i < n - 1; i += 1) {
			const dx = list[i + 1].x - list[i].x || 1;
			slopes.push((list[i + 1].y - list[i].y) / dx);
		}

		const tangents: number[] = [slopes[0]];
		for (let i = 1; i < n - 1; i += 1) {
			const a = slopes[i - 1];
			const b = slopes[i];
			tangents.push(a * b <= 0 ? 0 : (2 * a * b) / (a + b));
		}
		tangents.push(slopes[n - 2]);

		let d = `M${list[0].x} ${list[0].y}`;
		for (let i = 0; i < n - 1; i += 1) {
			const p0 = list[i];
			const p1 = list[i + 1];
			const dx = (p1.x - p0.x) / 3;
			d += `C${p0.x + dx} ${p0.y + dx * tangents[i]} ${p1.x - dx} ${p1.y - dx * tangents[i + 1]} ${p1.x} ${p1.y}`;
		}
		return d;
	}

	const path = $derived(curve(coords));
	const area = $derived(
		coords.length > 1
			? `${path}L${coords[coords.length - 1].x} ${height}L${coords[0].x} ${height}Z`
			: ''
	);
	const last = $derived(coords.at(-1) ?? null);
	const goalY = $derived(goalInView && goal !== null ? yOf(goal) : null);

	const MONTHS_SHORT = [
		'янв',
		'фев',
		'мар',
		'апр',
		'мая',
		'июн',
		'июл',
		'авг',
		'сен',
		'окт',
		'ноя',
		'дек'
	];

	/**
	 * Точки замеров рисуются, пока между ними есть воздух. За год десятки
	 * взвешиваний сливаются в бусы, которые спорят с самой линией.
	 */
	const dotsFit = $derived(
		coords.every((point, index) => index === 0 || point.x - coords[index - 1].x >= 10)
	);

	/** Год в подписи — только если период его пересекает: «29 сен 2025». */
	const crossesYear = $derived(values[0]?.date.slice(0, 4) !== values.at(-1)?.date.slice(0, 4));

	function short(date: string | undefined): string {
		if (!date) return '';
		const [year, month, day] = date.split('-').map(Number);
		return `${day} ${MONTHS_SHORT[month - 1]}${crossesYear ? ` ${year}` : ''}`;
	}

	/** Подписи шкалы не наезжают друг на друга: близкие к цели прячутся. */
	const labelsY = $derived(
		[
			{ key: 'high', y: yOf(high), text: format(high), strong: false },
			{ key: 'low', y: yOf(low), text: format(low), strong: false },
			...(goalY !== null && goal !== null
				? [{ key: 'goal', y: goalY, text: format(goal), strong: true }]
				: [])
		].filter(
			(item, index, list) =>
				item.strong ||
				!list.some(
					(other, otherIndex) =>
						otherIndex !== index &&
						Math.abs(other.y - item.y) < 13 &&
						(other.strong || otherIndex < index)
				)
		)
	);

	const signature = $derived(`${values.length}:${values[0]?.date ?? ''}`);
</script>

{#if coords.length === 0}
	<p class="py-2 text-sm text-muted-foreground">За этот период взвешиваний нет.</p>
{:else}
	<div bind:clientWidth={width} class="relative">
		{#key signature}
			<svg
				viewBox="0 0 {W} {height}"
				{height}
				class="block w-full overflow-visible"
				role="img"
				aria-label="{label}: от {format(low)} до {format(high)}"
			>
				<defs>
					<linearGradient id="{uid}-fill" x1="0" x2="0" y1="0" y2="1">
						<stop offset="0%" stop-color="var(--fx-tone)" stop-opacity="0.28" />
						<stop offset="100%" stop-color="var(--fx-tone)" stop-opacity="0" />
					</linearGradient>
				</defs>

				<line x1="0" x2={plotWidth} y1={yOf(high)} y2={yOf(high)} class="stroke-ink/5" />
				<line x1="0" x2={plotWidth} y1={yOf(low)} y2={yOf(low)} class="stroke-ink/5" />

				{#if goalY !== null}
					<line
						x1="0"
						x2={plotWidth}
						y1={goalY}
						y2={goalY}
						stroke-dasharray="3 4"
						stroke-linecap="round"
						class="stroke-foreground/45"
					/>
				{/if}

				{#if area}
					<path d={area} fill="url(#{uid}-fill)" class="fx-fade" style="--fx-step: 4;" />
				{/if}

				{#if coords.length > 1}
					<path
						d={path}
						pathLength="1"
						fill="none"
						stroke-width="2.25"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="fx-draw stroke-tone"
					/>
				{/if}

				<!-- Все замеры — точками, пока их не так много, чтобы слиться в линию. -->
				{#if dotsFit}
					{#each coords.slice(0, -1) as point (point.date)}
						<circle
							cx={point.x}
							cy={point.y}
							r="2.5"
							class="fx-fade fill-void stroke-tone"
							stroke-width="1.5"
							style="--fx-step: 5;"
						/>
					{/each}
				{/if}

				{#if last}
					<!-- Последний замер — «где я сейчас»: крупнее и с ореолом. -->
					<circle
						cx={last.x}
						cy={last.y}
						r="8"
						class="fx-fade fill-tone/20"
						style="--fx-step: 6;"
					/>
					<circle cx={last.x} cy={last.y} r="4" class="fx-fade fill-tone" style="--fx-step: 6;" />
				{/if}
			</svg>
		{/key}

		<div
			aria-hidden="true"
			class="pointer-events-none absolute top-0 right-0"
			style="width: {GUTTER - 6}px; height: {height}px;"
		>
			{#each labelsY as item (item.key)}
				<span
					class="tabular absolute right-0 -translate-y-1/2 text-[11px] leading-none
					       {item.strong ? 'font-medium text-foreground/80' : 'text-muted-foreground/80'}"
					style="top: {item.y}px;"
				>
					{item.text}
				</span>
			{/each}
		</div>

		<div
			aria-hidden="true"
			class="mt-2 flex justify-between text-[11px] leading-none text-muted-foreground"
			style="width: {plotWidth}px;"
		>
			<span>{short(values[0]?.date)}</span>
			<span>{short(values.at(-1)?.date)}</span>
		</div>
	</div>
{/if}
