<script lang="ts">
	import { toast } from '$lib/state/toast.svelte';
	import { telegram } from '$lib/telegram';

	function act() {
		telegram.haptic.impact('medium');
		toast.act();
	}
</script>

{#if toast.current}
	{@const current = toast.current}
	<!--
		Над нижней навигацией, а не поверх неё: «Отменить» не должно
		перекрывать кнопку, которой человек только что пользовался.
		z-[60] — выше шторки: быстрая запись закрывает её, но отмена
		должна оставаться видимой, даже если следом открылась другая.
	-->
	<div
		class="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
		style="bottom: calc(var(--fx-safe-bottom) + 6.25rem);"
	>
		{#key current.id}
			<div
				role="status"
				aria-live="polite"
				class="fx-rise pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-full
				       border border-line-strong bg-[var(--fx-glass-tint-solid)] py-2 pr-2 pl-4
				       shadow-lift"
			>
				<p class="min-w-0 flex-1 truncate text-sm">{current.message}</p>
				{#if current.action}
					<button
						type="button"
						onclick={act}
						class="shrink-0 rounded-full bg-amber/15 px-3.5 py-1.5 text-sm font-medium text-amber
						       transition-transform duration-500 ease-flux active:scale-95"
					>
						{current.action.label}
					</button>
				{/if}
			</div>
		{/key}
	</div>
{/if}
