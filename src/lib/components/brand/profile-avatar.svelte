<script lang="ts">
	type Props = {
		name: string;
		size?: number;
	};

	let { name, size = 44 }: Props = $props();

	const uid = $props.id();

	/** Стабильный хеш строки: одно имя всегда даёт одну и ту же картинку. */
	function hash(input: string): number {
		let h = 0;
		for (let i = 0; i < input.length; i++) {
			h = (h << 5) - h + input.charCodeAt(i);
			h |= 0;
		}
		return Math.abs(h);
	}

	const initials = $derived(
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);

	// От имени зависит только геометрия градиента, не оттенок. Случайный цвет
	// на аватаре сломал бы правило «один акцент на экран»: в ленте из аватарок
	// брендовая лаванда перестала бы читаться как акцент.
	const seed = $derived(hash(name || 'flux'));
	const angle = $derived(seed % 360);
	const shift = $derived(25 + (seed % 40));
</script>

<div class="relative shrink-0" style="width: {size}px; height: {size}px;">
	<svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Профиль: {name}">
		<defs>
			<linearGradient id="av-{uid}" gradientTransform="rotate({angle} 0.5 0.5)">
				<stop offset="0%" stop-color="var(--fx-lavender-hi)" />
				<stop offset="{shift}%" stop-color="var(--fx-lavender)" />
				<stop offset="100%" stop-color="var(--fx-lavender-lo)" />
			</linearGradient>

			<radialGradient id="av-sheen-{uid}" cx="30%" cy="22%" r="62%">
				<stop offset="0%" stop-color="#fff" stop-opacity="0.38" />
				<stop offset="100%" stop-color="#fff" stop-opacity="0" />
			</radialGradient>
		</defs>

		<circle cx="50" cy="50" r="50" fill="url(#av-{uid})" />
		<!-- Блик сверху слева: без него плоский градиент выглядит как заливка, а не как объём. -->
		<circle cx="50" cy="50" r="50" fill="url(#av-sheen-{uid})" />

		<text
			x="50"
			y="50"
			text-anchor="middle"
			dominant-baseline="central"
			font-size="38"
			font-weight="600"
			letter-spacing="0.5"
			fill="var(--fx-void)"
			font-family="var(--font-sans)"
		>
			{initials}
		</text>
	</svg>

	<!-- Волосяное кольцо поверх: отделяет аватар от тёмной подложки без грубой рамки. -->
	<span class="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/12 ring-inset"
	></span>
</div>
