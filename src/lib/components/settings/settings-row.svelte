<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { CaretRight, type IconComponentProps } from 'phosphor-svelte';
	import { cn } from '$lib/utils';
	import { telegram } from '$lib/telegram';

	type Tone = 'amber' | 'mint' | 'sky' | 'danger';

	type Props = {
		label: string;
		icon?: Component<IconComponentProps>;
		/**
		 * Тон чипа иконки. Без тона — лаванда: так на корневом экране
		 * строки разделов узнаются по цвету ещё до того, как прочитана подпись.
		 */
		tone?: Tone;
		/** Вторая строка под подписью: короткое пояснение или состояние. */
		hint?: string;
		/** Значение справа, как в iOS: «2 100 ккал», «Включены». */
		value?: string;
		/** Своё содержимое справа (переключатель, индикатор) вместо value. */
		trailing?: Snippet;
		href?: string;
		onclick?: () => void;
		/**
		 * Строка-подпись к скрытому полю ввода (выбор файла).
		 * Кнопка не может содержать input type="file", а label по for — может
		 * открыть его, оставаясь той же строкой списка.
		 */
		for?: string;
		disabled?: boolean;
		/** Стрелка по умолчанию только у ссылок: она обещает переход на другой экран. */
		chevron?: boolean;
	} & Omit<HTMLAttributes<HTMLElement>, 'onclick'>;

	let {
		label,
		icon: Icon,
		tone,
		hint,
		value,
		trailing,
		href,
		onclick,
		for: forId,
		disabled = false,
		chevron,
		class: className,
		...rest
	}: Props = $props();

	const tag = $derived(href ? 'a' : forId ? 'label' : onclick ? 'button' : 'div');
	const interactive = $derived(tag !== 'div' && !disabled);
	const showChevron = $derived(chevron ?? Boolean(href));
	const toneClass = $derived(tone && tone !== 'danger' ? `tone-${tone}` : undefined);

	function handleClick() {
		if (disabled) return;
		// Переход по ссылке — лёгкий тик, как у кнопки «Назад» в шапке.
		if (href) telegram.haptic.impact('light');
		onclick?.();
	}
</script>

<!--
	Строка списка настроек.

	Высота не меньше 52px: мишень касания с запасом над 44px из правил
	Apple, и в строку помещается вторая строка пояснения, не распирая её.
	Разделитель нарисован у текстовой части, а не у всей строки — он
	начинается от подписи, как в iOS, и не режет чип иконки.
-->
<svelte:element
	this={tag}
	{href}
	for={forId}
	type={tag === 'button' ? 'button' : undefined}
	disabled={tag === 'button' ? disabled : undefined}
	aria-disabled={tag !== 'button' && disabled ? 'true' : undefined}
	onclick={tag === 'div' ? undefined : handleClick}
	class={cn(
		'group/row relative flex min-h-[52px] w-full items-center gap-3 pl-4 text-left',
		'transition-colors duration-300 ease-flux',
		interactive && 'cursor-pointer hover:bg-ink/[0.02] active:bg-ink/[0.04]',
		disabled && 'pointer-events-none opacity-40',
		toneClass,
		className
	)}
	{...rest}
>
	{#if Icon}
		<span
			class="grid size-7 shrink-0 place-items-center rounded-lg
			       {tone === 'danger' ? 'bg-destructive/12' : 'bg-tone/12'}"
		>
			<Icon
				size={15}
				weight="regular"
				class={tone === 'danger' ? 'text-destructive' : 'text-tone'}
			/>
		</span>
	{/if}

	<span
		class="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 self-stretch border-t
		       border-line/60 py-2.5 pr-4 group-first/row:border-t-0"
	>
		<span class="min-w-0 flex-1">
			<!--
				Красная подпись — только у самого разрушительного действия.
				Ссылка, которая лишь ведёт к нему, остаётся обычного цвета
				с красным чипом: иначе красный на корне кричал бы без повода.
			-->
			<span class="block text-sm {tone === 'danger' && !href ? 'text-destructive' : ''}">
				{label}
			</span>
			{#if hint}
				<span class="block text-xs text-pretty text-muted-foreground">{hint}</span>
			{/if}
		</span>

		{#if trailing}
			{@render trailing()}
		{:else if value}
			<span class="tabular max-w-[45%] shrink-0 truncate text-right text-xs text-muted-foreground">
				{value}
			</span>
		{/if}

		{#if showChevron}
			<CaretRight size={14} weight="light" class="-mr-1 shrink-0 text-muted-foreground/70" />
		{/if}
	</span>
</svelte:element>
