<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CaretLeft } from 'phosphor-svelte';
	import { telegram } from '$lib/telegram';

	type Props = {
		title: string;
		subtitle?: string;
		/** Адрес возврата. Без него стрелка не рисуется. */
		back?: string;
		action?: Snippet;
	};

	let { title, subtitle, back, action }: Props = $props();
</script>

<!--
	Шапка экрана. Заголовок крупный и плотный по трекингу — он работает
	как ориентир «где я», а не как текст для чтения. Подзаголовок идёт
	ниже тише: дата, период, пояснение.
-->
<header class="mb-5 flex items-center gap-3">
	{#if back}
		<!--
			Стрелка — size-10: минимальная мишень касания. Стеклянная, как
			карточки, чтобы не выглядеть отдельной системной кнопкой браузера.
		-->
		<a
			href={back}
			onclick={() => telegram.haptic.impact('light')}
			aria-label="Назад"
			class="grid size-10 shrink-0 place-items-center rounded-full border border-line/80
			       bg-gradient-to-b from-surface-2 to-surface text-foreground/85
			       shadow-[inset_0_1px_0_0_var(--fx-glass-highlight),var(--fx-shadow-flat)]
			       transition-transform duration-500 ease-flux hover:border-line-strong active:scale-90"
		>
			<CaretLeft size={17} weight="regular" />
		</a>
	{/if}

	<div class="min-w-0 flex-1">
		<h1 class="truncate text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.025em]">
			{title}
		</h1>
		{#if subtitle}
			<p class="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
		{/if}
	</div>

	{#if action}
		{@render action()}
	{/if}
</header>
