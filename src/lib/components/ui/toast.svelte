<script lang="ts">
	import { Check } from 'phosphor-svelte';
	import { fade } from 'svelte/transition';
	import { toast, type Toast } from '$lib/state/toast.svelte';
	import { telegram } from '$lib/telegram';

	function act() {
		telegram.haptic.impact('medium');
		toast.act();
	}

	/**
	 * «Записано · Овсянка с ягодами» делится на итог и подробность.
	 *
	 * Итог читается первым и не обрезается, длинное название блюда —
	 * приглушённое и уходит в многоточие. Одной строкой обрезалось бы
	 * как раз то, ради чего тост показан, — слово «Записано».
	 */
	function split(message: string): [string, string | null] {
		const at = message.indexOf(' · ');
		return at === -1 ? [message, null] : [message.slice(0, at), message.slice(at + 3)];
	}

	/**
	 * Последнее показанное сообщение. Нужно на время затухания: в этот
	 * момент toast.current уже пуст, а исчезать должен тот же текст,
	 * а не пустая плашка.
	 */
	let last = $state<Toast | null>(null);
	$effect(() => {
		if (toast.current) last = toast.current;
	});

	function reducedMotion(): boolean {
		return (
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
		);
	}
</script>

{#if toast.current}
	{@const current = (toast.current ?? last) as Toast}
	{@const [lead, detail] = split(current.message)}
	<!--
		Над нижней навигацией, а не поверх неё: «Отменить» не должно
		перекрывать кнопку, которой человек только что пользовался.
		z-[60] — выше шторки: быстрая запись закрывает её, но отмена
		должна оставаться видимой, даже если следом открылась другая.
	-->
	<div
		class="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
		style="bottom: calc(var(--fx-safe-bottom) + 6.25rem);"
		out:fade={{ duration: reducedMotion() ? 0 : 240 }}
	>
		{#key current.id}
			<!--
				Уходит тихим затуханием (на обёртке — чтобы при замене одного
				сообщения другим два тоста не стояли рядом), а не пропадает
				рывком: исчезновение на полуслове выглядит как сбой.
				Янтарная кнопка — потому что тост с отменой сейчас бывает только
				у быстрой записи еды; появится другой раздел — тон надо будет
				передавать вместе с сообщением.
			-->
			<div
				role="status"
				aria-live="polite"
				class="fx-rise pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-full
				       border border-line-strong bg-[var(--fx-glass-tint-solid)] py-2 pr-2 pl-2.5
				       shadow-lift"
			>
				<span
					aria-hidden="true"
					class="grid size-7 shrink-0 place-items-center rounded-full bg-success/15 text-success"
				>
					<Check size={13} weight="bold" />
				</span>
				<p class="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
					<span class="shrink-0 font-medium">{lead}</span>
					{#if detail}
						<span class="min-w-0 truncate text-muted-foreground">{detail}</span>
					{/if}
				</p>
				{#if current.action}
					<button
						type="button"
						onclick={act}
						class="h-9 shrink-0 rounded-full bg-amber/15 px-3.5 text-sm font-medium text-amber
						       transition-transform duration-500 ease-flux active:scale-95"
					>
						{current.action.label}
					</button>
				{/if}
			</div>
		{/key}
	</div>
{/if}
