<script lang="ts">
	import { Camera } from 'phosphor-svelte';
	import { telegram } from '$lib/telegram';

	type Props = {
		label?: string;
		onclick?: () => void;
	};

	let { label = 'Сканировать еду', onclick }: Props = $props();

	function handle() {
		telegram.haptic.impact('medium');
		onclick?.();
	}
</script>

<!--
	Кнопка берёт тон карточки, в которой стоит: внутри янтарного раздела
	еды лавандовая заливка читалась как вход в чужой раздел (docs/design.md,
	«Цвета разделов»). Тень тоже в тоне — лавандовое свечение только у бренда.

	Текст тёмный, а не белый: на светлых тонах палитры белый проваливает
	WCAG AA, тёмный держит контраст выше 7:1.
-->
<button
	type="button"
	onclick={handle}
	aria-label={label}
	class="group flex w-full items-center gap-3 rounded-full bg-tone py-1.5 pr-5 pl-1.5
	       text-void shadow-[0_12px_32px_-16px_var(--fx-tone)] transition-[transform,filter]
	       duration-500 ease-flux hover:brightness-105 active:scale-[0.98]"
>
	<span class="relative grid size-10 shrink-0 place-items-center rounded-full bg-void/12">
		<!-- Рамка видоискателя. На наведении расходится наружу — жест «навожусь на кадр». -->
		<svg
			viewBox="0 0 40 40"
			class="absolute size-10 transition-transform duration-500 ease-flux group-hover:scale-110"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			opacity="0.55"
			aria-hidden="true"
		>
			<path d="M4 13V7a3 3 0 0 1 3-3h6" />
			<path d="M27 4h6a3 3 0 0 1 3 3v6" />
			<path d="M36 27v6a3 3 0 0 1-3 3h-6" />
			<path d="M13 36H7a3 3 0 0 1-3-3v-6" />
		</svg>

		<Camera size={19} weight="light" />
	</span>

	<span class="text-sm font-medium">{label}</span>
</button>
