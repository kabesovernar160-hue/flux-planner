<script lang="ts">
	import { Check, X } from 'phosphor-svelte';

	type Props = {
		onclose: () => void;
	};

	let { onclose }: Props = $props();
</script>

<!--
	Похвала без восклицательных знаков и конфетти: первая запись — повод
	спокойно сказать, что дальше будет так же просто, а не праздник,
	после которого обычный день кажется будничным.
-->
<div
	role="status"
	class="fx-rise mb-4 flex items-center gap-3 rounded-card border border-lavender/25
	       bg-lavender/[0.08] py-3 pr-2 pl-3.5"
>
	<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-lavender/12">
		<Check size={15} weight="bold" class="text-lavender" />
	</span>
	<p class="min-w-0 flex-1 text-xs leading-relaxed">
		Первая запись есть. Дальше так же — по одной, через «+» внизу.
	</p>
	<button
		type="button"
		onclick={onclose}
		aria-label="Скрыть"
		class="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground
		       transition-transform duration-500 ease-flux active:scale-90"
	>
		<X size={14} weight="light" />
	</button>
</div>
