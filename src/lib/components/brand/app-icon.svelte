<script lang="ts">
	/**
	 * Марка приложения.
	 *
	 * Вектором и внутри разметки, а не картинкой по ссылке: марка стоит
	 * на приветственном экране и в шапке дня, то есть попадается человеку
	 * в первую секунду. Картинка там означала бы отдельный запрос, пустое
	 * место на время загрузки и размытые края на экранах с высокой
	 * плотностью — за две сотни байт разметки это дорого.
	 *
	 * Идентификаторы градиентов уникальны на экземпляр: две марки на одной
	 * странице (шапка и шторка) с одинаковыми id склеились бы в одну,
	 * и вторая осталась бы без заливки.
	 */
	type Props = {
		size?: number;
		class?: string;
	};

	let { size = 44, class: className = '' }: Props = $props();

	const uid = $props.id();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 192 192"
	role="img"
	aria-label="Flux Planner"
	class="shrink-0 select-none {className}"
	style="box-shadow: 0 0 26px -4px oklch(0.7022 0.1527 293.82 / 0.28); border-radius: {size *
		0.26}px;"
>
	<defs>
		<!-- Подложка почти чёрная с лиловым подмесом: тот же --fx-void, что у фона приложения. -->
		<linearGradient id="{uid}-tile" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="#15101F" />
			<stop offset="100%" stop-color="#090611" />
		</linearGradient>

		<!-- Свет падает сверху справа, оттуда же растёт искра. -->
		<linearGradient id="{uid}-mark" x1="0.15" y1="1" x2="0.9" y2="0">
			<stop offset="0%" stop-color="#6D4DF0" />
			<stop offset="55%" stop-color="#9B7BF7" />
			<stop offset="100%" stop-color="#C9B4FF" />
		</linearGradient>

		<radialGradient id="{uid}-glow" cx="72%" cy="18%" r="70%">
			<stop offset="0%" stop-color="#A58AF4" stop-opacity="0.3" />
			<stop offset="100%" stop-color="#A58AF4" stop-opacity="0" />
		</radialGradient>
	</defs>

	<rect width="192" height="192" rx="50" fill="url(#{uid}-tile)" />
	<rect width="192" height="192" rx="50" fill="url(#{uid}-glow)" />
	<rect
		x="0.75"
		y="0.75"
		width="190.5"
		height="190.5"
		rx="49.25"
		fill="none"
		stroke="#A58AF4"
		stroke-opacity="0.26"
	/>

	<!--
		Буква F из трёх лепестков: длинный, средний и короткий, все с общим
		левым краем — он и читается как стойка буквы. Лепесток — прямоугольник,
		у которого скруглены два противоположных угла дугой в радиус высоты:
		отсюда и мягкое плечо слева, и срезанный кончик справа.
	-->
	<g fill="url(#{uid}-mark)">
		<path d="M52 88 A44 44 0 0 1 96 44 L148 44 A44 44 0 0 1 104 88 Z" />
		<path d="M52 140 A44 44 0 0 1 96 96 L134 96 A44 44 0 0 1 90 140 Z" />
		<path d="M52 192 A44 44 0 0 1 96 148 L114 148 A44 44 0 0 1 70 192 Z" />
	</g>

	<!--
		Искра. Четыре луча кривыми Безье, а не звёздочка из отрезков:
		у острых лучей на маленьком размере отваливаются кончики.
	-->
	<path d="M162 26 Q165 40 179 43 Q165 46 162 60 Q159 46 145 43 Q159 40 162 26 Z" fill="#E2D8FF" />
</svg>
