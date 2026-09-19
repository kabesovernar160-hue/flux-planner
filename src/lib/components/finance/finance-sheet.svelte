<script lang="ts">
	import Sheet from '$lib/components/ui/sheet.svelte';
	import FinanceForm from './finance-form.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';

	// Запись ищется по идентификатору: если её удалили с другого устройства,
	// шторка откроется как создание новой, а не упадёт.
	const entry = $derived(
		ui.financeEntryId
			? (plannerStore.financeEntries.find((item) => item.id === ui.financeEntryId) ?? null)
			: null
	);

	const title = $derived(
		entry ? 'Изменить запись' : ui.financeType === 'income' ? 'Новый доход' : 'Новая запись'
	);
</script>

<Sheet open={ui.financeSheetOpen} {title} onclose={() => ui.closeFinanceSheet()}>
	<!--
		key перемонтирует форму при смене предвыбранной категории: поля снимают
		начальные значения один раз, и без перемонтирования тап по другой быстрой
		кнопке открыл бы форму со старой категорией.
	-->
	{#key `${ui.financeEntryId}:${ui.financeType}:${ui.financeCategory}`}
		<FinanceForm
			{entry}
			presetCategory={ui.financeCategory}
			presetType={ui.financeType}
			onsaved={() => ui.closeFinanceSheet()}
			oncancel={() => ui.closeFinanceSheet()}
		/>
	{/key}
</Sheet>
