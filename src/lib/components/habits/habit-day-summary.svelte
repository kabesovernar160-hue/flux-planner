<script lang="ts">
	import { Check, Fire } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { pluralDays } from '$lib/utils/format';

	type Props = {
		done: number;
		planned: number;
		/** «Сегодня» или «25 сентября»: экран отмечает выбранный день, не всегда сегодняшний. */
		dayLabel: string;
		/** Лучшая текущая серия среди привычек. */
		best: { days: number; name: string } | null;
		class?: string;
		style?: string;
	};

	let { done, planned, dayLabel, best, class: className, style }: Props = $props();

	const RADIUS = 26;
	const LENGTH = 2 * Math.PI * RADIUS;

	const ratio = $derived(planned > 0 ? Math.min(1, done / planned) : 0);
	const complete = $derived(planned > 0 && done >= planned);
	const left = $derived(Math.max(0, planned - done));

	const hint = $derived.by(() => {
		if (planned === 0) return 'по расписанию ничего';
		if (complete) return 'всё отмечено';
		return `осталось ${left}`;
	});
</script>

<!--
	Сводка дня — ответ на вопрос, с которым открывают экран: «сколько ещё?».
	Цифра крупно, кольцо — чтобы долю было видно боковым зрением, серия —
	то, что держит привычки лучше любых напоминаний.
-->
<GlassCard tone="mint" bezel class={className} {style}>
	<div class="flex items-center gap-4">
		<div class="min-w-0 flex-1">
			<!--
				«из» набрано текстовым шрифтом: моноширинный предлог рядом с цифрой
				читался как часть числа, а пробел в моно-начертании почти пропадал.
			-->
			<p class="flex items-baseline gap-2 leading-none">
				<span class="fx-num text-5xl">{done}</span>
				<span class="text-3xl text-muted-foreground">из</span>
				<span class="fx-num text-3xl text-muted-foreground">{planned}</span>
			</p>
			<p class="mt-2 text-xs text-muted-foreground">
				{dayLabel} · <span class={complete ? 'text-tone' : ''}>{hint}</span>
			</p>
		</div>

		<div class="relative size-16 shrink-0">
			<svg
				viewBox="0 0 64 64"
				class="size-full -rotate-90"
				role="img"
				aria-label="Отмечено {done} из {planned}"
			>
				<circle cx="32" cy="32" r={RADIUS} fill="none" stroke-width="6" class="stroke-tone/12" />
				<circle
					cx="32"
					cy="32"
					r={RADIUS}
					fill="none"
					stroke-width="6"
					stroke-linecap="round"
					class="stroke-tone"
					stroke-dasharray={LENGTH}
					stroke-dashoffset={LENGTH * (1 - ratio)}
					style="transition: stroke-dashoffset 0.5s var(--fx-ease); opacity: {ratio > 0 ? 1 : 0};"
				/>
			</svg>
			{#if complete}
				<span class="absolute inset-0 grid place-items-center" aria-hidden="true">
					<Check size={20} weight="bold" class="text-tone" />
				</span>
			{/if}
		</div>
	</div>

	{#if best}
		<div class="mt-4 flex items-center gap-2 border-t border-line/60 pt-3.5 text-xs">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<Fire size={15} weight="regular" class="text-tone" />
			</span>
			<span class="text-muted-foreground">Лучшая серия</span>
			<span class="tabular font-medium text-tone">{best.days} {pluralDays(best.days)}</span>
			<span class="min-w-0 flex-1 truncate text-right text-muted-foreground">{best.name}</span>
		</div>
	{/if}
</GlassCard>
