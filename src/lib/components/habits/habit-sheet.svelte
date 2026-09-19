<script lang="ts">
	import Sheet from '$lib/components/ui/sheet.svelte';
	import HabitForm from './habit-form.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';

	// Привычка ищется по идентификатору при каждой отрисовке: если её удалили
	// с другого устройства, шторка откроется как создание новой, а не упадёт.
	const habit = $derived(
		ui.habitId ? (plannerStore.habits.find((item) => item.id === ui.habitId) ?? null) : null
	);
</script>

<Sheet
	open={ui.habitSheetOpen}
	title={habit ? 'Изменить привычку' : 'Новая привычка'}
	onclose={() => ui.closeHabitSheet()}
>
	<!--
		key перемонтирует форму при смене записи: поля снимают начальные
		значения один раз, и без этого в них остались бы данные предыдущей
		привычки.
	-->
	{#key ui.habitId}
		<HabitForm {habit} onsaved={() => ui.closeHabitSheet()} oncancel={() => ui.closeHabitSheet()} />
	{/key}
</Sheet>
