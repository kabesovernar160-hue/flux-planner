<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'phosphor-svelte';
	import { telegram } from '$lib/telegram';

	type Props = {
		open: boolean;
		title: string;
		onclose: () => void;
		children: Snippet;
	};

	let { open, title, onclose, children }: Props = $props();

	const titleId = $props.id();
	let panel = $state<HTMLElement | null>(null);

	function close() {
		telegram.haptic.impact('light');
		onclose();
	}

	$effect(() => {
		if (!open) return;

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
		<!-- Затемнение. Блюр здесь допустим: элемент зафиксирован и не скроллится. -->
		<button
			type="button"
			aria-label="Закрыть"
			onclick={close}
			class="absolute inset-0 bg-void/70 backdrop-blur-sm"
		></button>

		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			tabindex="-1"
			class="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88%] w-full max-w-md flex-col
			       overflow-hidden rounded-t-[2rem] border-t border-line bg-surface outline-none"
			style="padding-bottom: calc(var(--fx-safe-bottom) + 1rem);"
		>
			<!-- Блик по верхней кромке — та же деталь, что у карточек. -->
			<span
				aria-hidden="true"
				class="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r
				       from-transparent via-white/20 to-transparent"
			></span>

			<!-- Грабер: подсказывает, что шторку можно закрыть свайпом вниз. -->
			<div class="flex justify-center pt-2.5" aria-hidden="true">
				<span class="h-1 w-9 rounded-full bg-white/15"></span>
			</div>

			<header class="flex items-center gap-3 px-5 pt-3 pb-3">
				<h2 id={titleId} class="flex-1 text-base font-semibold tracking-tight">{title}</h2>
				<button
					type="button"
					onclick={close}
					aria-label="Закрыть"
					class="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.06]
					       transition-transform duration-500 ease-flux active:scale-90"
				>
					<X size={15} weight="light" />
				</button>
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
				{@render children()}
			</div>
		</div>
	</div>
{/if}
