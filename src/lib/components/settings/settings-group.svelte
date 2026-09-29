<script lang="ts">
	import type { Snippet } from 'svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';

	type Props = {
		children: Snippet;
		/** Подпись над группой — как в iOS: тихая, чтобы не спорить со строками. */
		title?: string;
		/** Пояснение под группой. Длинные объяснения живут здесь, а не в строках. */
		footer?: string | Snippet;
		tone?: 'amber' | 'mint' | 'sky';
		/** Шаг лесенки появления (--fx-step). */
		step?: number;
		/** Опасная группа: граница в тон destructive отделяет её от обычных. */
		danger?: boolean;
	};

	let { children, title, footer, tone, step = 0, danger = false }: Props = $props();
</script>

<!--
	Группа строк в одной карточке без внутренних отступов.

	Строки сами держат поля и высоту: так разделители между ними доходят
	до края текста, а подсветка нажатия заливает строку целиком, а не
	островок посередине карточки.
-->
<section class="fx-rise" style="--fx-step: {step}">
	{#if title}
		<h2 class="mb-2 px-1 text-xs {danger ? 'text-destructive' : 'text-muted-foreground'}">
			{title}
		</h2>
	{/if}

	<GlassCard padding="none" {tone} class={danger ? 'border-destructive/30' : undefined}>
		{@render children()}
	</GlassCard>

	{#if footer}
		<div class="mt-2 px-1 text-xs leading-relaxed text-pretty text-muted-foreground">
			{#if typeof footer === 'string'}
				<p>{footer}</p>
			{:else}
				{@render footer()}
			{/if}
		</div>
	{/if}
</section>
