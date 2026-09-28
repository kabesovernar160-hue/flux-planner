<script lang="ts">
	import type { Component } from 'svelte';
	import { telegram } from '$lib/telegram';

	type Props = {
		/** Одна строка о том, что здесь появится, — польза, а не констатация пустоты. */
		text: string;
		/** Подпись кнопки первого действия. */
		label: string;
		icon?: Component;
		/**
		 * Тон раздела, если карточка сама его не задаёт.
		 *
		 * В календаре карточки дня нейтральные, но кнопка «добавить еду»
		 * должна быть янтарной, как еда везде в приложении.
		 */
		tone?: 'amber' | 'mint' | 'sky';
		onclick: () => void;
	};

	let { text, label, icon: Icon, tone, onclick }: Props = $props();

	function run() {
		telegram.haptic.impact('light');
		onclick();
	}
</script>

<!--
	Пустое состояние внутри карточки.

	«Записей нет» сообщает очевидное и оставляет человека разбираться, что
	делать. Здесь вместо этого — зачем записывать и кнопка, которая сразу
	открывает нужную форму. Цвет кнопки берётся из тона карточки.
-->
<div class={tone ? `tone-${tone}` : undefined}>
	<p class="text-sm leading-relaxed text-muted-foreground">{text}</p>
	<!--
		min-h-10 — минимальная мишень касания по правилам. Подпись text-sm:
		это главное действие карточки, а не вторичная ссылка.
	-->
	<button
		type="button"
		onclick={run}
		class="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-full border
		       border-tone/30 bg-tone/10 px-4 py-2.5 text-sm font-medium
		       shadow-[inset_0_1px_0_0_oklch(1_0_0/0.05)] transition-[transform,border-color,background-color]
		       duration-500 ease-flux hover:border-tone/55 hover:bg-tone/14 active:scale-[0.98]"
	>
		{#if Icon}
			<Icon size={16} weight="regular" class="shrink-0 text-tone" />
		{/if}
		{label}
	</button>
</div>
