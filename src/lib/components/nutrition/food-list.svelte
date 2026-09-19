<script lang="ts">
	import { Camera, PencilSimple, Trash } from 'phosphor-svelte';
	import Sheet from '$lib/components/ui/sheet.svelte';
	import FoodForm from './food-form.svelte';
	import { removeFood } from '$lib/services/nutritionService';
	import type { FoodEntry } from '$lib/types/nutrition';
	import { telegram } from '$lib/telegram';
	import { formatNumber } from '$lib/utils/format';

	type Props = {
		entries: FoodEntry[];
		/** Показывать ли подсказку, когда записей нет. */
		empty?: string;
	};

	let { entries, empty = 'Сегодня пока ничего не записано.' }: Props = $props();

	/**
	 * Правка открывается шторкой с той же формой, что и ручное добавление.
	 * Отдельный экран правки означал бы вторую реализацию тех же полей
	 * и тех же проверок.
	 */
	let editing = $state<FoodEntry | null>(null);

	function remove(entry: FoodEntry) {
		telegram.haptic.impact('medium');
		removeFood(entry.id);
	}
</script>

{#if entries.length === 0}
	<p class="py-2 text-sm text-muted-foreground">{empty}</p>
{:else}
	<ul class="flex flex-col gap-1.5">
		{#each entries as entry (entry.id)}
			<li class="flex items-center gap-3 rounded-xl border border-line/70 bg-white/[0.02] p-3">
				<div class="min-w-0 flex-1">
					<p class="flex items-center gap-1.5 truncate text-sm font-medium">
						{#if entry.source === 'ai'}
							<!-- Помечаем оценку по фото: её точность иная, чем у введённой руками. -->
							<Camera size={13} weight="light" class="shrink-0 text-muted-foreground" />
						{/if}
						{entry.name}
					</p>
					<p class="tabular mt-0.5 text-xs text-muted-foreground">
						{formatNumber(entry.calories)} ккал
						{#if entry.grams}· {formatNumber(entry.grams)} г{/if}
						· Б {formatNumber(entry.protein)} · Ж {formatNumber(entry.fat)} · У {formatNumber(
							entry.carbs
						)}
					</p>
				</div>

				<button
					type="button"
					onclick={() => {
						telegram.haptic.impact('light');
						editing = entry;
					}}
					aria-label="Изменить {entry.name}"
					class="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong
					       transition-transform duration-500 ease-flux active:scale-90"
				>
					<PencilSimple size={13} weight="light" />
				</button>

				<button
					type="button"
					onclick={() => remove(entry)}
					aria-label="Удалить {entry.name}"
					class="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong
					       text-muted-foreground transition-transform duration-500 ease-flux active:scale-90"
				>
					<Trash size={13} weight="light" />
				</button>
			</li>
		{/each}
	</ul>
{/if}

<Sheet open={editing !== null} title="Изменить запись" onclose={() => (editing = null)}>
	{#if editing}
		<!--
			key по идентификатору: форма снимает начальные значения один раз,
			и без пересоздания при смене записи в полях остались бы данные
			предыдущего блюда.
		-->
		{#key editing.id}
			<FoodForm
				entry={editing}
				onsaved={() => (editing = null)}
				oncancel={() => (editing = null)}
			/>
		{/key}
	{/if}
</Sheet>
