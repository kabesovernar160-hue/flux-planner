<script lang="ts">
	import { untrack } from 'svelte';
	import {
		addTransaction,
		CATEGORY_LABELS,
		updateTransaction,
		validateFinanceDraft,
		type FinanceDraft
	} from '$lib/services/financeService';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import {
		categoriesFor,
		isCategoryFor,
		type FinanceCategory,
		type FinanceEntry,
		type FinanceEntryType
	} from '$lib/types/finance';
	import { telegram } from '$lib/telegram';

	type Props = {
		/** Запись для правки. Без неё форма создаёт новую. */
		entry?: FinanceEntry | null;
		/** Предвыбранная категория — приходит из быстрых кнопок на дашборде. */
		presetCategory?: FinanceCategory;
		/** Предвыбранный тип: кнопка «Доход» открывает форму сразу дохода. */
		presetType?: FinanceEntryType;
		onsaved: () => void;
		oncancel?: () => void;
	};

	let { entry = null, presetCategory, presetType, onsaved, oncancel }: Props = $props();

	const uid = $props.id();

	// Форма редактирует копию и не следит за пропами: иначе приходящие снаружи
	// данные затирали бы ввод прямо во время набора.
	const initial = untrack(() => entry);
	const initialCategory = untrack(() => presetCategory);
	const initialType = untrack(() => presetType);

	let type = $state<FinanceDraft['type']>(initial?.type ?? initialType ?? 'expense');

	/** Набор категорий зависит от типа: у дохода свой, у расхода свой. */
	const categories = $derived(categoriesFor(type));
	let amount = $state(initial ? String(initial.amount) : '');
	let category = $state<FinanceCategory>(
		initial?.category ??
			(initialCategory && isCategoryFor(initial?.type ?? initialType ?? 'expense', initialCategory)
				? initialCategory
				: categoriesFor(initial?.type ?? initialType ?? 'expense')[0])
	);
	let note = $state(initial?.note ?? '');
	let date = $state(initial?.date ?? untrack(() => plannerStore.currentDate));

	let errors = $state<Record<string, string>>({});
	let submitted = $state(false);

	function toNumber(value: string): number {
		// На цифровой клавиатуре телефона дробная часть отделяется запятой.
		const normalized = value.trim().replace(',', '.');
		return normalized === '' ? Number.NaN : Number(normalized);
	}

	function buildDraft(): FinanceDraft {
		return { type, amount: toNumber(amount), category, note, date };
	}

	$effect(() => {
		if (submitted) errors = validateFinanceDraft(buildDraft());
	});

	function pickType(next: FinanceDraft['type']) {
		telegram.haptic.selection();
		type = next;

		// Категория расхода в доходе не имеет смысла, поэтому при переключении
		// подставляется первая подходящая — иначе форма молча осталась бы
		// с невалидным выбором, а ошибка всплыла бы только при отправке.
		if (!isCategoryFor(next, category)) category = categoriesFor(next)[0];
	}

	function pickCategory(next: FinanceCategory) {
		telegram.haptic.selection();
		category = next;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		submitted = true;

		const draft = buildDraft();
		const found = validateFinanceDraft(draft);
		errors = found;

		if (Object.keys(found).length > 0) {
			telegram.haptic.notification('error');
			return;
		}

		const result = initial ? updateTransaction(initial.id, draft) : addTransaction(draft);

		if (!result.ok) {
			errors = result.errors;
			telegram.haptic.notification('error');
			return;
		}

		telegram.haptic.notification('success');
		onsaved();
	}

	const FIELD =
		'w-full rounded-xl border bg-white/[0.03] px-3 py-2.5 text-sm outline-none ' +
		'transition-colors duration-300 ease-flux placeholder:text-muted-foreground/50 ' +
		'focus:border-lavender';
</script>

<form onsubmit={submit} class="py-1">
	<!-- Расход или доход. Сегменты, а не выпадающий список: вариантов всего два. -->
	<div class="flex rounded-full border border-line-strong p-1" role="group" aria-label="Тип записи">
		{#each [['expense', 'Расход'], ['income', 'Доход']] as const as [value, label] (value)}
			<button
				type="button"
				onclick={() => pickType(value)}
				aria-pressed={type === value}
				class="flex-1 rounded-full py-2 text-xs font-medium transition-colors duration-300 ease-flux
				       {type === value
					? value === 'income'
						? 'bg-success text-void'
						: 'bg-lavender text-void'
					: 'text-muted-foreground'}"
			>
				{label}
			</button>
		{/each}
	</div>

	<div class="mt-3.5 flex flex-col gap-1.5">
		<label for="{uid}-amount" class="text-xs text-muted-foreground">Сумма</label>
		<input
			id="{uid}-amount"
			bind:value={amount}
			type="text"
			inputmode="decimal"
			autocomplete="off"
			placeholder="0"
			aria-invalid={Boolean(errors.amount)}
			aria-describedby={errors.amount ? `${uid}-amount-error` : undefined}
			class="tabular {FIELD} text-lg font-semibold {errors.amount
				? 'border-destructive'
				: 'border-line-strong'}"
		/>
		{#if errors.amount}
			<p id="{uid}-amount-error" class="text-xs text-destructive">{errors.amount}</p>
		{/if}
	</div>

	<fieldset class="mt-4">
		<legend class="mb-2 text-xs text-muted-foreground">Категория</legend>
		<div class="flex flex-wrap gap-1.5">
			{#each categories as value (value)}
				<button
					type="button"
					onclick={() => pickCategory(value)}
					aria-pressed={category === value}
					class="rounded-full border px-3 py-1.5 text-xs transition-colors duration-300 ease-flux
					       {category === value
						? 'border-lavender bg-lavender/15 text-lavender'
						: 'border-line-strong text-muted-foreground'}"
				>
					{CATEGORY_LABELS[value]}
				</button>
			{/each}
		</div>
	</fieldset>

	<div class="mt-4 grid grid-cols-[1fr_auto] gap-3">
		<div class="flex min-w-0 flex-col gap-1.5">
			<label for="{uid}-note" class="text-xs text-muted-foreground">Заметка</label>
			<input
				id="{uid}-note"
				bind:value={note}
				type="text"
				autocomplete="off"
				placeholder="необязательно"
				class="{FIELD} border-line-strong"
			/>
		</div>

		<div class="flex flex-col gap-1.5">
			<label for="{uid}-date" class="text-xs text-muted-foreground">Дата</label>
			<input
				id="{uid}-date"
				bind:value={date}
				type="date"
				class="{FIELD} border-line-strong [color-scheme:dark]"
			/>
		</div>
	</div>

	<div class="mt-5 flex gap-2">
		{#if oncancel}
			<button
				type="button"
				onclick={oncancel}
				class="flex-1 rounded-full border border-line-strong py-3 text-sm font-medium
				       transition-transform duration-500 ease-flux active:scale-[0.98]"
			>
				Отмена
			</button>
		{/if}
		<button
			type="submit"
			class="flex-[1.4] rounded-full py-3 text-sm font-medium text-void shadow-accent
			       transition-transform duration-500 ease-flux active:scale-[0.98]
			       {type === 'income' ? 'bg-success hover:brightness-110' : 'bg-lavender hover:bg-lavender-hi'}"
		>
			{initial ? 'Сохранить' : type === 'income' ? 'Добавить доход' : 'Добавить трату'}
		</button>
	</div>
</form>
