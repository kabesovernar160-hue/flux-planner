<script lang="ts" module>
	/**
	 * Кривая ease-flux для переходов Svelte.
	 *
	 * Переходы Svelte принимают функцию, а не строку CSS, поэтому та же
	 * cubic-bezier(0.32, 0.72, 0, 1), что и в layout.css, пересчитана здесь.
	 * Бисекция, а не метод Ньютона: двадцать шагов на кадр ничего не стоят,
	 * зато не бывает расхождения на пологих участках кривой.
	 */
	function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
		const coord = (t: number, p1: number, p2: number) =>
			3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;

		return (x: number) => {
			if (x <= 0) return 0;
			if (x >= 1) return 1;

			let lo = 0;
			let hi = 1;
			let t = x;
			for (let i = 0; i < 20; i += 1) {
				t = (lo + hi) / 2;
				if (coord(t, x1, x2) < x) lo = t;
				else hi = t;
			}
			return coord(t, y1, y2);
		};
	}

	const flux = cubicBezier(0.32, 0.72, 0, 1);

	/** Смещение, после которого отпущенная шторка закрывается, а не возвращается. */
	const CLOSE_DISTANCE_PX = 120;
	/** Быстрый смах закрывает и с меньшего расстояния: так ведут себя системные шторки. */
	const CLOSE_VELOCITY = 0.6; // пикселей в миллисекунду
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { X } from 'phosphor-svelte';
	import { telegram } from '$lib/telegram';

	type Props = {
		open: boolean;
		title: string;
		onclose: () => void;
		children: Snippet;
		/**
		 * Тон раздела. Шторка еды — янтарная, трат — голубая: кнопки и чипы
		 * внутри берут цвет из --fx-tone, и форма не спорит с карточкой,
		 * из которой её открыли.
		 */
		tone?: 'amber' | 'mint' | 'sky';
	};

	let { open, title, onclose, children, tone }: Props = $props();

	const titleId = $props.id();
	let panel = $state<HTMLElement | null>(null);

	/** Смещение шторки пальцем, в пикселях. Ноль — шторка на месте. */
	let drag = $state(0);
	/** Палец отпущен, шторка возвращается на место — с переходом, а не рывком. */
	let settling = $state(false);

	let pointerId: number | null = null;
	let startY = 0;
	let lastY = 0;
	let lastTime = 0;
	let velocity = 0;

	function reducedMotion(): boolean {
		return (
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
		);
	}

	function close() {
		telegram.haptic.impact('light');
		onclose();
	}

	/**
	 * Выезд снизу и уход вниз.
	 *
	 * Уход начинается с того места, где шторку отпустил палец: иначе после
	 * свайпа она сперва прыгнула бы обратно наверх, а потом поехала вниз.
	 */
	function rise(node: HTMLElement) {
		const height = node.offsetHeight || 600;
		const from = drag;
		return {
			duration: reducedMotion() ? 0 : 420,
			easing: flux,
			css: (_t: number, u: number) =>
				`transform: translate3d(0, ${from + u * (height - from)}px, 0)`
		};
	}

	function backdrop(node: HTMLElement) {
		return fade(node, { duration: reducedMotion() ? 0 : 320, easing: flux });
	}

	/*
	 * Свайп вниз за ручку и заголовок.
	 *
	 * Только за верхнюю полосу, а не за всю шторку: внутри есть прокрутка,
	 * и браузер забирает жест себе (pointercancel), как только решает, что
	 * это прокрутка. Полоса сверху — touch-action: none, спорить не с кем.
	 */
	function dragStart(event: PointerEvent) {
		if (event.button !== 0) return;
		// Нажатие на «Закрыть» — это нажатие, а не начало свайпа.
		if ((event.target as HTMLElement).closest('button')) return;

		pointerId = event.pointerId;
		startY = lastY = event.clientY;
		lastTime = event.timeStamp;
		velocity = 0;
		settling = false;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function dragMove(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;

		const dt = event.timeStamp - lastTime;
		if (dt > 0) velocity = (event.clientY - lastY) / dt;
		lastY = event.clientY;
		lastTime = event.timeStamp;

		// Вверх шторка не тянется: выше своей высоты ей некуда.
		drag = Math.max(0, event.clientY - startY);
	}

	function dragEnd(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		pointerId = null;

		const fast = velocity > CLOSE_VELOCITY && drag > 16;
		if (drag > CLOSE_DISTANCE_PX || fast) {
			close();
			return;
		}

		settling = drag > 0;
		drag = 0;
	}

	$effect(() => {
		if (!open) return;

		// Новое открытие — с нуля: прошлый свайп мог оставить смещение.
		drag = 0;
		settling = false;

		// Фон не должен прокручиваться под открытой шторкой: иначе палец
		// уводит страницу, а шторка остаётся висеть посреди экрана.
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		// Фокус уходит внутрь, чтобы Esc и чтение с экрана работали по шторке,
		// а не по спрятанной под ней странице.
		const previouslyFocused = document.activeElement as HTMLElement | null;
		panel?.focus();

		const onKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') close();
		};
		document.addEventListener('keydown', onKeydown);

		return () => {
			document.body.style.overflow = previousOverflow;
			document.removeEventListener('keydown', onKeydown);
			previouslyFocused?.focus?.();
		};
	});
</script>

{#if open}
	<!--
		Слой шторки. z-50 — уровень выше навигации (z-40), других произвольных
		значений в проекте нет.
	-->
	<div class="fixed inset-0 z-50">
		<!--
			Затемнение. Блюр здесь допустим: элемент зафиксирован и не скроллится.
			Пока шторку тянут вниз, затемнение светлеет — видно, что отпускание
			её закроет.
		-->
		<button
			type="button"
			aria-label="Закрыть"
			onclick={close}
			transition:backdrop
			class="absolute inset-0 bg-scrim backdrop-blur-sm"
			style:opacity={drag > 0 ? Math.max(0.35, 1 - drag / 400) : undefined}
		></button>

		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			tabindex="-1"
			transition:rise
			class="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col overflow-hidden
			       rounded-t-[2rem] border-t border-line bg-surface outline-none
			       {tone ? `tone-${tone}` : ''}"
			style:max-height="min(88%, calc(100% - var(--fx-safe-top) - 3rem))"
			style:padding-bottom="calc(var(--fx-safe-bottom) + 1rem)"
			style:transform={drag > 0 ? `translate3d(0, ${drag}px, 0)` : undefined}
			style:transition={settling ? 'transform 320ms var(--fx-ease)' : undefined}
			ontransitionend={() => (settling = false)}
		>
			<!-- Блик по верхней кромке — та же деталь, что у карточек. -->
			<span
				aria-hidden="true"
				class="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r
				       from-transparent via-[var(--fx-glass-edge)] to-transparent"
			></span>

			{#if tone}
				<!--
					Слабое свечение тона в углу — как у карточки раздела: шторку
					узнаёшь боковым зрением, ещё не прочитав заголовок.
				-->
				<span
					aria-hidden="true"
					class="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full opacity-[0.1]
					       blur-3xl"
					style="background: var(--fx-tone);"
				></span>
			{/if}

			<!--
				Ручка и заголовок — зона свайпа. touch-action: none, чтобы браузер
				не принял движение за прокрутку и не отнял жест.
			-->
			<div
				class="relative shrink-0 cursor-grab touch-none active:cursor-grabbing"
				onpointerdown={dragStart}
				onpointermove={dragMove}
				onpointerup={dragEnd}
				onpointercancel={dragEnd}
				role="presentation"
			>
				<!-- Ручка: подсказывает, что шторку можно закрыть свайпом вниз. -->
				<div class="flex justify-center pt-2.5" aria-hidden="true">
					<span
						class="h-1 w-9 rounded-full transition-colors duration-300 ease-flux
						       {drag > 0 ? 'bg-ink/30' : 'bg-ink/15'}"
					></span>
				</div>

				<header class="flex items-center gap-3 px-5 pt-3 pb-3">
					<h2 id={titleId} class="flex-1 text-base font-semibold tracking-tight">{title}</h2>
					<button
						type="button"
						onclick={close}
						aria-label="Закрыть"
						class="grid size-9 shrink-0 place-items-center rounded-full bg-ink/[0.06]
						       text-muted-foreground transition-[transform,color] duration-500 ease-flux
						       hover:text-foreground active:scale-90"
					>
						<X size={15} weight="light" />
					</button>
				</header>
			</div>

			<!-- overscroll-contain: докрученный до конца список не тянет за собой страницу. -->
			<div class="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2">
				{@render children()}
			</div>
		</div>
	</div>
{/if}
