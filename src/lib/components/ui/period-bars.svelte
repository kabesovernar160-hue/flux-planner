<script module lang="ts">
	import type { DayValue } from '$lib/utils/analytics';

	/**
	 * Как сворачивать длинный период в столбцы.
	 *
	 * «mean» — среднее по всем дням корзины (траты, привычки): день без трат —
	 * это ноль, и он честно тянет среднее вниз. «meanActive» — только по дням
	 * с записями (калории): незаписанный обед не значит, что его не было.
	 */
	export type Aggregate = 'mean' | 'meanActive';

	type Scale = 'day' | 'week' | 'month';

	export interface Bucket {
		key: string;
		from: string;
		to: string;
		value: number;
	}

	const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
	const WEEKDAYS_LONG = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
	const MONTHS_SHORT = [
		'янв',
		'фев',
		'мар',
		'апр',
		'май',
		'июн',
		'июл',
		'авг',
		'сен',
		'окт',
		'ноя',
		'дек'
	];
	const MONTHS_OF = [
		'января',
		'февраля',
		'марта',
		'апреля',
		'мая',
		'июня',
		'июля',
		'августа',
		'сентября',
		'октября',
		'ноября',
		'декабря'
	];
	const MONTHS = [
		'январь',
		'февраль',
		'март',
		'апрель',
		'май',
		'июнь',
		'июль',
		'август',
		'сентябрь',
		'октябрь',
		'ноябрь',
		'декабрь'
	];

	function parts(date: string): [number, number, number] {
		const [year, month, day] = date.split('-').map(Number);
		return [year, month, day];
	}

	function weekdayIndex(date: string): number {
		const [year, month, day] = parts(date);
		return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	}

	/**
	 * Масштаб по длине ряда.
	 *
	 * Больше месяца по дням не рисуем: 90 столбцов по три пикселя — это
	 * штрихкод, а не график, и глаз не находит в нём ни одной недели.
	 * Квартал сворачивается в недели, год — в месяцы.
	 */
	export function scaleOf(length: number): Scale {
		if (length <= 31) return 'day';
		if (length <= 120) return 'week';
		return 'month';
	}

	function reduce(values: DayValue[], mode: Aggregate): number {
		const pool = mode === 'meanActive' ? values.filter((day) => day.value > 0) : values;
		if (pool.length === 0) return 0;
		return (
			pool.reduce((total, day) => total + (Number.isFinite(day.value) ? day.value : 0), 0) /
			pool.length
		);
	}

	export function bucketsOf(values: DayValue[], mode: Aggregate): Bucket[] {
		const scale = scaleOf(values.length);
		if (scale === 'day') {
			return values.map((day) => ({
				key: day.date,
				from: day.date,
				to: day.date,
				value: day.value
			}));
		}

		const groups: DayValue[][] = [];
		if (scale === 'week') {
			// Недели отсчитываются от конца: последняя корзина всегда кончается
			// сегодняшним днём, неполной остаётся самая старая, а не текущая.
			for (let end = values.length; end > 0; end -= 7) {
				groups.unshift(values.slice(Math.max(0, end - 7), end));
			}
		} else {
			for (const day of values) {
				const last = groups.at(-1);
				if (last && last[0].date.slice(0, 7) === day.date.slice(0, 7)) last.push(day);
				else groups.push([day]);
			}
		}

		return groups.map((group) => ({
			key: group[0].date,
			from: group[0].date,
			to: group[group.length - 1].date,
			value: reduce(group, mode)
		}));
	}

	/** Подпись для скринридера и подсказки: «чт, 24 сентября», «7–13 сентября», «сентябрь». */
	function longLabel(bucket: Bucket, scale: Scale): string {
		const [, fromMonth, fromDay] = parts(bucket.from);
		const [, toMonth, toDay] = parts(bucket.to);
		if (scale === 'day')
			return `${WEEKDAYS_LONG[weekdayIndex(bucket.from)]}, ${fromDay} ${MONTHS_OF[fromMonth - 1]}`;
		if (scale === 'month') return MONTHS[fromMonth - 1];
		if (fromMonth === toMonth) return `${fromDay}–${toDay} ${MONTHS_OF[toMonth - 1]}`;
		return `${fromDay} ${MONTHS_OF[fromMonth - 1]} — ${toDay} ${MONTHS_OF[toMonth - 1]}`;
	}

	/**
	 * Подпись оси под столбцом или null, если под ним подписи нет.
	 *
	 * Отсчёт тоже от конца: крайняя правая подпись — это «сейчас», и она
	 * есть всегда. Слева подписи прореживаются так, чтобы между ними
	 * оставалось место: 11px не сжимаются, как столбцы.
	 */
	function tickLabel(
		bucket: Bucket,
		index: number,
		length: number,
		scale: Scale,
		narrow: boolean
	): string | null {
		const fromEnd = length - 1 - index;
		const [, month, day] = parts(bucket.from);
		if (scale === 'day') {
			// В узком мини-графике «Пн Вт Ср» слипаются; одна буква — как
			// в полосе дней на главной, там её уже привыкли читать.
			if (length <= 7) return WEEKDAYS[weekdayIndex(bucket.from)].slice(0, narrow ? 1 : 2);
			return fromEnd % 7 === 0 ? `${day} ${MONTHS_SHORT[month - 1]}` : null;
		}
		if (scale === 'week') return fromEnd % 4 === 0 ? `${day} ${MONTHS_SHORT[month - 1]}` : null;
		return fromEnd % 2 === 0 ? MONTHS_SHORT[month - 1] : null;
	}

	/**
	 * Круглый верх шкалы: 1, 2, 2,5 или 5 × 10ⁿ.
	 *
	 * Подпись «2 347» у верхней линии заставляет считать, «2 500» — нет.
	 */
	function niceCeil(value: number): number {
		if (value <= 0) return 1;
		const power = 10 ** Math.floor(Math.log10(value));
		for (const step of [1, 2, 2.5, 5, 10]) {
			if (value <= step * power) return step * power;
		}
		return 10 * power;
	}

	/** «2,4к», «15к», «850» — подписи оси должны влезть в узкое поле справа. */
	export function compact(value: number): string {
		if (Math.abs(value) < 1000) return String(Math.round(value));
		const thousands = value / 1000;
		const text =
			thousands >= 10 ? String(Math.round(thousands)) : thousands.toFixed(1).replace('.0', '');
		return `${text.replace('.', ',')}к`;
	}
</script>

<script lang="ts">
	import { formatNumber } from '$lib/utils/format';

	type Props = {
		values: DayValue[];
		/** Цель или лимит за день. Рисуется пунктиром — сразу видно дни с превышением. */
		goal?: number;
		/** Подписи под столбцами. */
		labels?: boolean;
		/** Высота поля графика в пикселях, без подписей. */
		height?: number;
		/** Столбцы выше цели красятся тревожным цветом. */
		warnOverGoal?: boolean;
		/** День, который подсвечивается (обычно сегодня). */
		highlight?: string;
		/** Как сворачивать длинные периоды в недели и месяцы. */
		aggregate?: Aggregate;
		/** Подпись значения в подсказке: «2 350». */
		format?: (value: number) => string;
		/** Единица после значения в подсказке: «ккал», «%». */
		unit?: string;
		/** Подписи шкалы справа. На маленьких графиках итогов недели не нужны. */
		axis?: boolean;
		/** Подпись оси. По умолчанию — «2,4к». */
		axisFormat?: (value: number) => string;
		/** Что это за график — для скринридера. */
		label?: string;
	};

	let {
		values,
		goal,
		labels = true,
		height = 120,
		warnOverGoal = false,
		highlight,
		aggregate = 'mean',
		format = (value: number) => formatNumber(Math.round(value)),
		unit = '',
		axis = true,
		axisFormat = compact,
		label = 'График по дням'
	}: Props = $props();

	/**
	 * Реальная ширина в пикселях, а не растянутый viewBox.
	 *
	 * При preserveAspectRatio="none" скругления столбцов сплющивались бы
	 * по-разному на телефоне и в широком окне десктопного Telegram.
	 * До первого замера — типичная ширина карточки на телефоне.
	 */
	let width = $state(0);
	const W = $derived(width || 300);

	/** Поле справа под подписи шкалы. */
	const GUTTER = 34;
	/** Запас сверху: верхняя подпись шкалы и самый высокий столбец не упираются в край. */
	const TOP = 6;

	const scale = $derived(scaleOf(values.length));
	const buckets = $derived(bucketsOf(values, aggregate));
	const plotWidth = $derived(W - (axis ? GUTTER : 0));
	const slot = $derived(plotWidth / Math.max(1, buckets.length));

	// Чем столбцов больше, тем меньше воздуха между ними: на семи днях
	// широкий зазор делает график лёгким, на тридцати съел бы сами столбцы.
	const barWidth = $derived(
		Math.min(28, slot * (buckets.length <= 14 ? 0.56 : buckets.length <= 31 ? 0.66 : 0.72))
	);

	// Шкалу задаёт и цель: иначе на спокойной неделе пунктир уезжает за край.
	const peak = $derived(Math.max(...buckets.map((bucket) => bucket.value), goal ?? 0));
	const top = $derived(niceCeil(peak));
	const y = (value: number) => TOP + (1 - value / top) * (height - TOP);
	const goalY = $derived(goal && goal > 0 ? y(goal) : null);

	/** Подпись верха шкалы прячется, если сливается с подписью цели. */
	const showTop = $derived(goalY === null || goalY - TOP > 18);

	const highlightIndex = $derived(
		highlight
			? buckets.findIndex((bucket) => bucket.from <= highlight && highlight <= bucket.to)
			: -1
	);

	/** Путь столбца со скруглённым верхом и плоским низом — он стоит на оси, а не висит. */
	function barPath(x: number, value: number): string {
		const h = Math.max(0, height - y(value));
		const r = Math.min(barWidth / 2, 6, h);
		const yTop = height - h;
		return (
			`M${x} ${height}V${yTop + r}Q${x} ${yTop} ${x + r} ${yTop}` +
			`H${x + barWidth - r}Q${x + barWidth} ${yTop} ${x + barWidth} ${yTop + r}V${height}Z`
		);
	}

	const bars = $derived(
		buckets.map((bucket, index) => {
			const x = index * slot + (slot - barWidth) / 2;
			return {
				...bucket,
				index,
				x,
				center: x + barWidth / 2,
				over: warnOverGoal && goal !== undefined && goal > 0 && bucket.value > goal,
				tick: labels ? tickLabel(bucket, index, buckets.length, scale, slot < 26) : null,
				long: longLabel(bucket, scale)
			};
		})
	);

	/**
	 * Выбранный столбец. Касание показывает точное значение — так график
	 * отвечает на вопрос «а сколько было в четверг», не превращаясь
	 * в таблицу цифр над каждым столбцом.
	 */
	let selected = $state<number | null>(null);

	// Смена периода сбрасывает выбор: индекс из старого ряда указывал бы
	// на другой день нового.
	const signature = $derived(`${values.length}:${values[0]?.date ?? ''}:${aggregate}`);
	$effect(() => {
		void signature;
		selected = null;
	});

	function pick(index: number) {
		selected = selected === index ? null : index;
	}

	const valueText = (value: number) => `${format(value)}${unit ? ` ${unit}` : ''}`;
	const perDay = $derived(scale === 'day' ? '' : ' в день');

	/** Столбцы вырастают лесенкой, но вся лесенка укладывается в ~170 мс. */
	const stagger = (index: number) => Math.round(index * Math.min(1, 12 / buckets.length));
</script>

<div bind:clientWidth={width} class="relative">
	{#if selected !== null && bars[selected]}
		{@const bar = bars[selected]}
		<!--
			Подсказка прижимается к той половине графика, где стоит столбец,
			чтобы не вылезать за край карточки.
		-->
		<div
			class="fx-fade pointer-events-none absolute -top-1 z-10 rounded-full border border-line/80
			       bg-[var(--fx-glass-tint-solid)] px-2.5 py-1 text-[11px] whitespace-nowrap
			       shadow-lift"
			style={bar.center < plotWidth / 2
				? `left: ${Math.max(0, bar.center - 20)}px;`
				: `right: ${Math.max(0, W - bar.center - 20)}px;`}
		>
			<span class="text-muted-foreground">{bar.long}</span>
			<span class="tabular ml-1 font-medium text-foreground">{valueText(bar.value)}{perDay}</span>
		</div>
	{/if}

	{#key signature}
		<svg
			viewBox="0 0 {W} {height}"
			{height}
			class="block w-full overflow-visible"
			role="img"
			aria-label={label}
		>
			<!-- Сетка: верх шкалы и середина. Тише данных, чтобы не спорить с ними. -->
			<line x1="0" x2={plotWidth} y1={y(top)} y2={y(top)} class="stroke-ink/5" />
			<line x1="0" x2={plotWidth} y1={y(top / 2)} y2={y(top / 2)} class="stroke-ink/5" />

			{#if buckets.length <= 14}
				<!-- Дорожки под столбцами: пустой день остаётся видимым местом, а не дырой. -->
				{#each bars as bar (bar.key)}
					<rect
						x={bar.x}
						y={TOP}
						width={barWidth}
						height={height - TOP}
						rx={Math.min(barWidth / 2, 6)}
						class="fill-tone/[0.05]"
					/>
				{/each}
			{/if}

			{#each bars as bar (bar.key)}
				{@const isToday = bar.index === highlightIndex}
				{@const dim = selected !== null && selected !== bar.index}
				{#if bar.value > 0}
					<path
						d={barPath(bar.x, bar.value)}
						class="fx-grow transition-opacity duration-300 ease-flux
						       {bar.over ? 'fill-destructive' : 'fill-tone'}"
						style="--fx-i: {stagger(bar.index)}; fill-opacity: var(--fx-chart-fill); opacity: {dim
							? 0.3
							: isToday || highlightIndex < 0
								? 1
								: 0.72};"
					/>
				{:else}
					<!-- Ноль — короткая метка на оси: «записей не было», а не «данные потерялись». -->
					<rect
						x={bar.x + barWidth / 2 - Math.min(3, barWidth / 2)}
						y={height - 3}
						width={Math.min(6, barWidth)}
						height="3"
						rx="1.5"
						class="fill-ink/[0.12]"
					/>
				{/if}
			{/each}

			<!-- Базовая линия поверх столбцов: закрывает их нижний край ровной кромкой. -->
			<line x1="0" x2={plotWidth} y1={height - 0.5} y2={height - 0.5} class="stroke-line" />

			{#if goalY !== null}
				<line
					x1="0"
					x2={plotWidth}
					y1={goalY}
					y2={goalY}
					stroke-width="1"
					stroke-dasharray="3 4"
					stroke-linecap="round"
					class="stroke-foreground/45"
				/>
			{/if}
		</svg>
	{/key}

	{#if axis}
		<!-- Подписи шкалы — HTML, а не <text> в SVG: так они берут шрифт и сглаживание интерфейса. -->
		<div
			aria-hidden="true"
			class="pointer-events-none absolute top-0 right-0"
			style="width: {GUTTER}px; height: {height}px;"
		>
			{#if showTop}
				<span
					class="tabular absolute right-0 -translate-y-1/2 text-[11px] leading-none text-muted-foreground/80"
					style="top: {y(top)}px;"
				>
					{axisFormat(top)}
				</span>
			{/if}
			{#if goalY !== null && goal}
				<span
					class="tabular absolute right-0 -translate-y-1/2 text-[11px] leading-none font-medium text-foreground/80"
					style="top: {goalY}px;"
				>
					{axisFormat(goal)}
				</span>
			{/if}
			<span
				class="tabular absolute right-0 -translate-y-1/2 text-[11px] leading-none text-muted-foreground/60"
				style="top: {height}px;"
			>
				0
			</span>
		</div>
	{/if}

	<!--
		Касание по столбцу. Кнопки поверх SVG, по одной на столбец: так у каждого
		дня есть доступное имя со значением, и скринридер читает график
		как список, а не как безымянную картинку.
	-->
	<div class="absolute top-0 left-0 flex" style="width: {plotWidth}px; height: {height}px;">
		{#each bars as bar (bar.key)}
			<button
				type="button"
				class="h-full flex-1 cursor-pointer focus-visible:rounded-md"
				aria-label="{bar.long}: {valueText(bar.value)}{perDay}"
				aria-pressed={selected === bar.index}
				onclick={() => pick(bar.index)}
			></button>
		{/each}
	</div>

	{#if labels}
		<div aria-hidden="true" class="relative mt-2 h-3" style="width: {plotWidth}px;">
			{#each bars as bar (bar.key)}
				{#if bar.tick}
					{@const edgeRight = bar.center > plotWidth - 24}
					{@const edgeLeft = bar.center < 24}
					<span
						class="absolute top-0 text-[11px] leading-none whitespace-nowrap
						       {bar.index === highlightIndex ? 'font-medium text-tone' : 'text-muted-foreground'}"
						style={edgeRight && buckets.length > 7
							? `right: ${plotWidth - bar.x - barWidth}px;`
							: edgeLeft && buckets.length > 7
								? `left: ${bar.x}px;`
								: `left: ${bar.center}px; transform: translateX(-50%);`}
					>
						{bar.tick}
					</span>
				{/if}
			{/each}
		</div>
	{/if}
</div>
