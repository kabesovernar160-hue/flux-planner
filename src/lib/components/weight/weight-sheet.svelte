<script lang="ts">
	import Sheet from '$lib/components/ui/sheet.svelte';
	import WeightForm from './weight-form.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
</script>

<Sheet open={ui.weightSheetOpen} title="Взвешивание" onclose={() => ui.closeWeightSheet()}>
	<!--
		key по дате: форма снимает начальные значения один раз, и после перехода
		полуночи в ней осталось бы вчерашнее взвешивание.
	-->
	{#key plannerStore.currentDate}
		<WeightForm onsaved={() => ui.closeWeightSheet()} oncancel={() => ui.closeWeightSheet()} />
	{/key}
</Sheet>
