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

<header class="mb-5 flex items-center gap-3">
	{#if back}
		<a
			href={back}
			onclick={() => telegram.haptic.impact('light')}
			aria-label="Назад"
			class="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong
			       transition-transform duration-500 ease-flux active:scale-90"
		>
			<CaretLeft size={16} weight="light" />
		</a>
	{/if}

	<div class="min-w-0 flex-1">
		<h1 class="truncate text-[1.75rem] leading-tight font-semibold tracking-tight">{title}</h1>
		{#if subtitle}
			<p class="truncate text-xs text-muted-foreground">{subtitle}</p>
		{/if}
	</div>

	{#if action}
		{@render action()}
	{/if}
</header>
