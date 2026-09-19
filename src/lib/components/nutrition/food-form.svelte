<script lang="ts">
	import { untrack } from 'svelte';
	import {
		addFood,
		updateFood,
		validateFoodDraft,
		type FoodDraft
	} from '$lib/services/nutritionService';
	import FoodPicker from './food-picker.svelte';
	import type { FoodEntry, FoodReference } from '$lib/types/nutrition';
	import { telegram } from '$lib/telegram';
	import { nutritionForGrams } from '$lib/utils/foodScan';

	type Props = {
		/** Запись для правки. Без неё форма создаёт новую. */
		entry?: FoodEntry | null;
		onsaved: () => void;
		oncancel?: () => void;
	};

	let { entry = null, onsaved, oncancel }: Props = $props();

	const uid = $props.id();

	/**
	 * Начальные значения снимаются один раз.
	 *
	 * Форма редактирует копию, а не следит за пропом: если бы поля пересчитывались
	 * при каждом изменении entry, ввод пользователя затирался бы приходящими
	 * снаружи данными прямо во время набора. untrack проговаривает это явно
	 * и убирает предупреждение компилятора о чтении реактивного значения.
	 */
	const initial = untrack(() => entry);

	/**
	 * Поля хранятся строками, а не числами.
	 *
	 * У input type="number" нельзя нормально очистить поле: bind отдаёт то число,
	 * то undefined, и пользователь не может стереть ноль, чтобы вписать своё
	 * значение. Плюс на цифровой клавиатуре телефона дробная часть отделяется
	 * запятой, которую Number() не понимает.
	 */
	let name = $state(initial?.name ?? '');
	let grams = $state(initial?.grams != null ? String(initial.grams) : '');
	let calories = $state(initial ? String(initial.calories) : '');
	let protein = $state(initial ? String(initial.protein) : '');
	let fat = $state(initial ? String(initial.fat) : '');
	let carbs = $state(initial ? String(initial.carbs) : '');

	let errors = $state<Record<string, string>>({});
	let submitted = $state(false);

	/**
	 * Выбранный продукт справочника.
	 *
	 * Пока он есть, калории и макросы пересчитываются от граммов — это и есть
	 * весь смысл поиска: не считать в уме «сколько в 180 граммах овсянки».
	 * Как только человек правит макрос руками, связь рвётся: дальше он знает
	 * лучше, и подменять его цифры своими нельзя.
	 */
	let reference = $state<FoodReference | null>(null);

	/** Типичные порции. Одно нажатие вместо набора числа на ходу. */
	const QUICK_GRAMS = [50, 100, 150, 200, 300];

	function applyReference(grams: number) {
		if (!reference) return;

		const values = nutritionForGrams(reference.per100g, grams);
		calories = String(values.calories);
		protein = String(values.protein);
		fat = String(values.fat);
		carbs = String(values.carbs);
	}

	function pickReference(food: FoodReference) {
		reference = food;
		name = food.name;

		const parsed = toNumber(grams);
		const weight = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
		grams = String(weight);
		applyReference(weight);
	}

	function setGrams(next: string) {
		grams = next;
		const parsed = toNumber(next);
		if (Number.isFinite(parsed) && parsed > 0) applyReference(parsed);
	}

	function pickGrams(value: number) {
		telegram.haptic.selection();
		setGrams(String(value));
	}

	/** Ручная правда числа важнее подстановки: связь со справочником рвём. */
	function setManual(assign: (next: string) => void) {
		return (next: string) => {
			reference = null;
			assign(next);
		};
	}

	function toNumber(value: string): number {
		const normalized = value.trim().replace(',', '.');
		if (normalized === '') return Number.NaN;
		return Number(normalized);
	}

	function buildDraft(): Partial<FoodDraft> {
		return {
			name,
			// Вес необязателен: пустое поле означает «не указано», а не ноль.
			grams: grams.trim() === '' ? undefined : toNumber(grams),
			calories: toNumber(calories),
			protein: toNumber(protein),
			fat: toNumber(fat),
			carbs: toNumber(carbs)
		};
	}

	// Пока форму не отправляли, ошибки не показываются: подсвечивать пустые поля
	// красным до первой попытки — значит ругаться на человека за то,
	// что он ещё не начал заполнять.
	$effect(() => {
		if (submitted) errors = validateFoodDraft(buildDraft());
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		submitted = true;

		const draft = buildDraft();
		const found = validateFoodDraft(draft);
		errors = found;

		if (Object.keys(found).length > 0) {
			telegram.haptic.notification('error');
			return;
		}

		const result = entry ? updateFood(entry.id, draft as FoodDraft) : addFood(draft as FoodDraft);

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

<!-- Подпись над полем, ошибка под ним. Плейсхолдер вместо подписи не используется. -->
{#snippet field(
	key: string,
	label: string,
	value: string,
	set: (next: string) => void,
	placeholder: string,
	numeric: boolean
)}
	{@const error = errors[key]}
	<div class="flex min-w-0 flex-col gap-1.5">
		<label for="{uid}-{key}" class="text-xs text-muted-foreground">{label}</label>
		<input
			id="{uid}-{key}"
			{value}
			oninput={(event) => set(event.currentTarget.value)}
			type="text"
			inputmode={numeric ? 'decimal' : undefined}
			autocomplete="off"
			{placeholder}
			aria-invalid={Boolean(error)}
			aria-describedby={error ? `${uid}-${key}-error` : undefined}
			class="{numeric ? 'tabular ' : ''}{FIELD} {error
				? 'border-destructive'
				: 'border-line-strong'}"
		/>
		{#if error}
			<p id="{uid}-{key}-error" class="text-xs text-destructive">{error}</p>
		{/if}
	</div>
{/snippet}

<form onsubmit={submit} class="py-1">
	{#if !entry}
		<!--
			Поиск только при создании: при правке записи название уже выбрано,
			а подстановка чужих значений поверх правки сбивала бы с толку.
		-->
		<div class="mb-4">
			<FoodPicker onpick={pickReference} />
		</div>
	{/if}

	{@render field('name', 'Название', name, (next) => (name = next), 'Овсянка с ягодами', false)}

	<div class="mt-3.5 grid grid-cols-2 gap-3">
		{@render field(
			'calories',
			'Калории, ккал',
			calories,
			setManual((next) => (calories = next)),
			'0',
			true
		)}
		{@render field('grams', 'Порция, г', grams, setGrams, 'необязательно', true)}
	</div>

	{#if reference}
		<div class="mt-2 flex flex-wrap items-center gap-1.5">
			{#each QUICK_GRAMS as value (value)}
				<button
					type="button"
					onclick={() => pickGrams(value)}
					class="rounded-full border border-line-strong px-3 py-1 text-[11px] text-muted-foreground
					       transition-transform duration-500 ease-flux active:scale-95"
				>
					{value} г
				</button>
			{/each}
			<span class="ml-auto text-[11px] text-muted-foreground">
				{reference.name}: {reference.per100g.calories} ккал / 100 г
			</span>
		</div>
	{/if}

	<div class="mt-3.5 grid grid-cols-3 gap-2">
		{@render field(
			'protein',
			'Белки',
			protein,
			setManual((next) => (protein = next)),
			'0',
			true
		)}
		{@render field(
			'fat',
			'Жиры',
			fat,
			setManual((next) => (fat = next)),
			'0',
			true
		)}
		{@render field(
			'carbs',
			'Углеводы',
			carbs,
			setManual((next) => (carbs = next)),
			'0',
			true
		)}
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
			class="flex-[1.4] rounded-full bg-lavender py-3 text-sm font-medium text-void
			       shadow-accent transition-transform duration-500 ease-flux
			       hover:bg-lavender-hi active:scale-[0.98]"
		>
			{entry ? 'Сохранить' : 'Добавить'}
		</button>
	</div>
</form>
