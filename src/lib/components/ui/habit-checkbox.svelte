<script lang="ts">
	import type { Component } from 'svelte';
	import { telegram } from '$lib/telegram';

	type Props = {
		label: string;
		checked: boolean;
		onchange: (next: boolean) => void;
		/** Иконка Phosphor: помогает опознать привычку до чтения подписи. */
		icon?: Component;
	};

	let { label, checked, onchange, icon }: Props = $props();

	function toggle() {
		const next = !checked;

		// Успех отдаём только на выполнение привычки. Снятие галочки — это
		// не успех, и «победный» паттерн вибрации на нём читается фальшиво;
		// там уместнее нейтральный лёгкий отклик.
		if (next) telegram.haptic.notification('success');
		else telegram.haptic.impact('light');

		onchange(next);
	}
</script>

<button
	type="button"
	role="checkbox"
	aria-checked={checked}
	aria-label={label}
	onclick={toggle}
	class="group flex w-full items-center gap-3 rounded-lg py-1.5 text-left
	       transition-transform duration-500 ease-flux active:scale-[0.99]"
>
	<span
		class="relative grid size-6 shrink-0 place-items-center overflow-hidden rounded-[0.5rem]
		       border transition-colors duration-400 ease-flux
		       {checked ? 'border-tone' : 'border-line-strong group-hover:border-tone/60'}"
	>
		<!--
			Заливка приезжает отдельным слоем через scale, а не сменой
			background-color: масштаб уходит на GPU, и «чернильный» рост
			от центра читается как физическое действие, а не как перекраска.
		-->
		<span
			class="absolute inset-0 rounded-[0.35rem] bg-tone transition-transform duration-400 ease-flux"
			style="transform: scale({checked ? 1 : 0});"
		></span>

		<!-- Галочка прорисовывается: dasharray равен длине пути (≈20,2). -->
		<svg
			viewBox="0 0 24 24"
			class="relative size-4"
			fill="none"
			stroke="var(--fx-void)"
			stroke-width="3"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path
				d="M5 12.5l4.5 4.5L19 7"
				stroke-dasharray="21"
				stroke-dashoffset={checked ? 0 : 21}
				style="transition: stroke-dashoffset 0.45s var(--fx-ease) {checked ? '0.12s' : '0s'};"
			/>
		</svg>
	</span>

	{#if icon}
		{@const Icon = icon}
		<Icon
			size={17}
			weight="light"
			class="shrink-0 transition-colors duration-400 ease-flux
			       {checked ? 'text-tone' : 'text-muted-foreground'}"
		/>
	{/if}

	<span
		class="min-w-0 flex-1 truncate text-sm transition-colors duration-400 ease-flux
		       {checked ? 'text-muted-foreground line-through decoration-line-strong' : ''}"
	>
		{label}
	</span>
</button>
