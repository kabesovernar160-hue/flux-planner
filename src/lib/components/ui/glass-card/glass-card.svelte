<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';
	import { haptics } from '$lib/telegram';

	type Padding = 'none' | 'sm' | 'md' | 'lg';
	type Radius = 'card' | 'shell' | 'full';
	type Tone = 'amber' | 'mint' | 'sky';

	type Props = {
		children: Snippet;
		class?: string;
		padding?: Padding;
		/**
		 * Радиус задаётся пропом, а не классом снаружи.
		 *
		 * cn() не знает кастомных значений темы: 'rounded-card' и 'rounded-full'
		 * он считает разными группами и оставляет оба, после чего победитель
		 * зависит от порядка правил в собранном CSS. Явный проп убирает лотерею.
		 */
		radius?: Radius;
		/**
		 * Настоящий backdrop-filter.
		 *
		 * ВКЛЮЧАТЬ ТОЛЬКО на fixed/sticky-элементах: нижняя навигация, модалки,
		 * шторки, шапка. На карточке внутри скроллящегося списка блюр заставляет
		 * GPU пересчитывать подложку каждый кадр — в WebView Telegram это
		 * ощутимая просадка кадров на среднем Android.
		 *
		 * По умолчанию стекло собирается из градиента, волосяной границы и
		 * внутреннего блика. Выглядит так же, стоит ноль.
		 */
		blur?: boolean;
		/**
		 * Двойная обойма: внешняя «оправа» + внутреннее ядро с концентрическими
		 * радиусами. Приём для акцентных карточек (герой, итог дня, виджет).
		 * Для плотных списков не нужен — лишний DOM и визуальный шум.
		 */
		bezel?: boolean;
		/**
		 * Тон раздела. Красит всё внутри (полоски, кольца, иконки с классом
		 * text-tone) и добавляет слабое свечение в верхнем углу, по которому
		 * карточку узнаёшь боковым зрением, не читая заголовок.
		 */
		tone?: Tone;
		/** Реакция на наведение и нажатие. Включается автоматически при href/onclick. */
		interactive?: boolean;
		href?: string;
		/** Тактильная отдача при тапе. Отключается для деструктивных действий со своей хаптикой. */
		haptic?: boolean;
		/**
		 * Объявлен явно: карточка рендерится то в button, то в a, то в div,
		 * и унаследованный тип был бы пересечением несовместимых обработчиков.
		 */
		onclick?: (event: MouseEvent & { currentTarget: EventTarget & HTMLElement }) => void;
	} & Omit<HTMLButtonAttributes & HTMLAnchorAttributes, 'class' | 'href' | 'onclick'>;

	let {
		children,
		class: className,
		padding = 'md',
		radius = 'card',
		blur = false,
		bezel = false,
		tone,
		interactive,
		href,
		haptic = true,
		onclick,
		...rest
	}: Props = $props();

	const isInteractive = $derived(interactive ?? (Boolean(href) || Boolean(onclick)));
	const tag = $derived(href ? 'a' : onclick || interactive ? 'button' : 'div');

	const paddings: Record<Padding, string> = {
		none: '',
		sm: 'p-3.5',
		md: 'p-5',
		lg: 'p-7'
	};

	const radii: Record<Radius, string> = {
		card: 'rounded-card',
		shell: 'rounded-shell',
		full: 'rounded-full'
	};

	const toneClass = $derived(tone ? `tone-${tone}` : undefined);

	function handleClick(event: MouseEvent & { currentTarget: EventTarget & HTMLElement }) {
		if (haptic && isInteractive) haptics.tap();
		onclick?.(event);
	}
</script>

{#snippet surface()}
	<!--
		Волосяной блик по верхней кромке: имитация света, поймавшего край стекла.
		Единственная деталь, которая отличает «карточку с границей» от стекла.
	-->
	<span
		aria-hidden="true"
		class="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent
		       via-white/20 to-transparent"
	></span>

	{#if tone}
		<!--
			Свечение намеренно почти незаметное: карточка различается
			по тону, но не начинает светиться, как вывеска.
		-->
		<span
			aria-hidden="true"
			class="pointer-events-none absolute -top-16 -right-12 size-48 rounded-full opacity-[0.13] blur-3xl"
			style="background: var(--fx-tone);"
		></span>
	{/if}

	<!--
		Тень наведения вынесена в отдельный слой и анимируется через opacity.
		Переход самого box-shadow вызывал бы перерисовку каждый кадр.
	-->
	{#if isInteractive}
		<span
			aria-hidden="true"
			class="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0
			       transition-opacity duration-500 ease-flux group-hover:opacity-100"
			style="box-shadow: var(--fx-shadow-lift);"
		></span>
	{/if}

	<div class="relative">
		{@render children()}
	</div>
{/snippet}

{#if bezel}
	<!--
		ВНЕШНЯЯ ОПРАВА. Радиус 1.75rem, внутренний отступ 0.375rem (p-1.5).
		Радиус ядра = 1.75 - 0.375 = 1.375rem — только так дуги остаются
		концентрическими. Если поменять отступ, пересчитать и радиус ядра.
	-->
	<svelte:element
		this={tag}
		{href}
		type={tag === 'button' ? 'button' : undefined}
		onclick={isInteractive ? handleClick : undefined}
		class={cn(
			'group relative block w-full rounded-[1.75rem] p-1.5 text-left',
			'border border-white/[0.04] bg-white/[0.02]',
			'transition-transform duration-500 ease-flux',
			isInteractive && 'active:scale-[0.985]',
			toneClass,
			className
		)}
		{...rest}
	>
		<div
			class={cn(
				'relative overflow-hidden rounded-[1.375rem]',
				'border border-line/80',
				'shadow-[inset_0_1px_0_0_var(--fx-glass-highlight)]',
				blur
					? 'bg-[var(--fx-glass-tint)] backdrop-blur-[var(--fx-glass-blur)]'
					: 'bg-gradient-to-b from-surface-2 to-surface',
				paddings[padding]
			)}
		>
			{@render surface()}
		</div>
	</svelte:element>
{:else}
	<svelte:element
		this={tag}
		{href}
		type={tag === 'button' ? 'button' : undefined}
		onclick={isInteractive ? handleClick : undefined}
		class={cn(
			'group relative block w-full overflow-hidden text-left',
			radii[radius],
			'border border-line/80',
			'shadow-[inset_0_1px_0_0_var(--fx-glass-highlight),var(--fx-shadow-flat)]',
			blur
				? 'bg-[var(--fx-glass-tint)] backdrop-blur-[var(--fx-glass-blur)]'
				: 'bg-gradient-to-b from-surface-2 to-surface',
			'transition-transform duration-500 ease-flux',
			isInteractive && 'hover:border-line-strong active:scale-[0.985]',
			paddings[padding],
			toneClass,
			className
		)}
		{...rest}
	>
		{@render surface()}
	</svelte:element>
{/if}
