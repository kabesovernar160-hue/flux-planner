<script lang="ts">
	import { ArrowRight, Check, Sparkle } from 'phosphor-svelte';
	import AppIcon from '$lib/components/brand/app-icon.svelte';
	import StartActions from '$lib/components/first-run/start-actions.svelte';
	import { saveProfile, skipOnboarding } from '$lib/services/profileService';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import {
		ACTIVITY_LABELS,
		calculateGoals,
		GOAL_LABELS,
		validateProfile,
		type ActivityLevel,
		type ProfileInput,
		type Sex,
		type WeightGoal
	} from '$lib/utils/goals';
	import { hasAnyRecords } from '$lib/utils/firstRun';
	import { formatNumber } from '$lib/utils/format';

	type Props = {
		/** Закрыть, не применяя. Первый запуск закрывается только через «Пропустить». */
		onclose: () => void;
	};

	let { onclose }: Props = $props();

	const uid = $props.id();

	/**
	 * Шаги, а не одна длинная форма.
	 *
	 * На телефоне анкета из восьми полей выглядит как работа, а три коротких
	 * экрана — как разговор. Первый запуск — единственное место, где человек
	 * решает, стоит ли приложение его времени.
	 */
	type Step = 'intro' | 'body' | 'activity' | 'result' | 'start';

	let step = $state<Step>('intro');

	const existing = plannerStore.doc.settings.profile;

	let sex = $state<Sex>(existing?.sex ?? 'male');
	let age = $state(existing ? String(existing.age) : '');
	let heightCm = $state(existing ? String(existing.heightCm) : '');
	let weightKg = $state(existing ? String(existing.weightKg) : '');
	let activity = $state<ActivityLevel>(existing?.activity ?? 'medium');
	let goal = $state<WeightGoal>(existing?.goal ?? 'maintain');

	let errors = $state<Record<string, string>>({});

	function toNumber(value: string): number {
		const normalized = value.trim().replace(',', '.');
		return normalized === '' ? Number.NaN : Number(normalized);
	}

	const draft = $derived<ProfileInput>({
		sex,
		age: toNumber(age),
		heightCm: toNumber(heightCm),
		weightKg: toNumber(weightKg),
		activity,
		goal
	});

	// Предпросмотр целей считается на лету: человек видит, как цифры меняются
	// от выбора активности, ещё до того, как нажмёт «Применить».
	const preview = $derived(
		Object.keys(validateProfile(draft)).length === 0 ? calculateGoals(draft) : null
	);

	function next(to: Step) {
		telegram.haptic.impact('light');
		step = to;
	}

	function goToActivity() {
		const found = validateProfile(draft);
		// На втором шаге проверяем только то, что спрашивали на первом:
		// ругаться за невыбранную активность, пока её не показали, нельзя.
		const bodyErrors = Object.fromEntries(
			Object.entries(found).filter(([key]) => ['sex', 'age', 'heightCm', 'weightKg'].includes(key))
		);

		errors = bodyErrors;
		if (Object.keys(bodyErrors).length > 0) {
			telegram.haptic.notification('error');
			return;
		}

		next('activity');
	}

	function apply() {
		const result = saveProfile(draft);

		if (!result.ok) {
			errors = result.errors;
			telegram.haptic.notification('error');
			step = 'body';
			return;
		}

		telegram.haptic.notification('success');

		// Анкета заканчивается не пустым экраном, а первым действием:
		// цели посчитаны, но пока нечего сравнивать с ними. Тем, у кого
		// записи уже есть (второе устройство), предлагать начинать незачем.
		if (hasAnyRecords(plannerStore)) onclose();
		else step = 'start';
	}

	function skip() {
		telegram.haptic.impact('light');
		skipOnboarding();
		onclose();
	}

	const FIELD =
		'w-full rounded-xl border bg-white/[0.03] px-3 py-2.5 text-sm outline-none ' +
		'transition-colors duration-300 ease-flux placeholder:text-muted-foreground/50 ' +
		'focus:border-lavender';
</script>

{#snippet numberField(
	key: 'age' | 'heightCm' | 'weightKg',
	label: string,
	placeholder: string,
	value: string,
	set: (next: string) => void
)}
	<div class="flex min-w-0 flex-col gap-1.5">
		<label for="{uid}-{key}" class="text-xs text-muted-foreground">{label}</label>
		<input
			id="{uid}-{key}"
			{value}
			oninput={(event) => set(event.currentTarget.value)}
			type="text"
			inputmode="numeric"
			autocomplete="off"
			{placeholder}
			aria-invalid={Boolean(errors[key])}
			class="tabular {FIELD} {errors[key] ? 'border-destructive' : 'border-line-strong'}"
		/>
		{#if errors[key]}
			<p class="text-xs text-destructive">{errors[key]}</p>
		{/if}
	</div>
{/snippet}

<!--
	Отдельный слой поверх приложения, а не шторка: на первом запуске за ним
	всё равно пустой дашборд, и полупрозрачный фон показывал бы нули,
	которые ещё ничего не значат.
-->
<div
	role="dialog"
	aria-modal="true"
	aria-label="Первый запуск"
	class="fixed inset-0 z-50 overflow-y-auto bg-void"
	style="
		padding-top: calc(var(--fx-safe-top) + 1.5rem);
		padding-bottom: calc(var(--fx-safe-bottom) + 1.5rem);
		padding-left: calc(var(--fx-safe-left) + 1.25rem);
		padding-right: calc(var(--fx-safe-right) + 1.25rem);
	"
>
	<div class="mx-auto w-full max-w-md">
		{#if step === 'intro'}
			<div class="flex flex-col items-center py-10 text-center">
				<AppIcon size={64} />
				<h1 class="mt-6 text-2xl font-semibold tracking-tight">Flux Planner</h1>
				<p class="mt-3 text-sm leading-relaxed text-muted-foreground">
					Питание, привычки и деньги одного дня на одном экране. Считать калории можно по фото,
					поиском по справочнику или вручную.
				</p>
				<p class="mt-4 text-sm leading-relaxed text-muted-foreground">
					Пять вопросов — и цели будут посчитаны под вас, а не взяты из воздуха.
				</p>

				<button
					type="button"
					onclick={() => next('body')}
					class="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-lavender py-3.5
					       text-sm font-medium text-void shadow-accent transition-transform duration-500
					       ease-flux active:scale-[0.98]"
				>
					Посчитать цели
					<ArrowRight size={16} weight="bold" />
				</button>
				<button
					type="button"
					onclick={skip}
					class="mt-2 w-full rounded-full py-3 text-sm text-muted-foreground
					       transition-colors duration-400 ease-flux hover:text-foreground"
				>
					Пропустить
				</button>
			</div>
		{:else if step === 'body'}
			<h1 class="text-xl font-semibold tracking-tight">Немного о вас</h1>
			<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
				Нужно для расчёта нормы. Данные остаются на устройстве и в вашем аккаунте.
			</p>

			<div class="mt-5 flex rounded-full border border-line-strong p-1" role="group">
				{#each [['male', 'Мужчина'], ['female', 'Женщина']] as const as [value, label] (value)}
					<button
						type="button"
						onclick={() => {
							telegram.haptic.selection();
							sex = value;
						}}
						aria-pressed={sex === value}
						class="flex-1 rounded-full py-2.5 text-xs font-medium transition-colors duration-300
						       ease-flux {sex === value ? 'bg-lavender text-void' : 'text-muted-foreground'}"
					>
						{label}
					</button>
				{/each}
			</div>

			<div class="mt-4 grid grid-cols-3 gap-3">
				{@render numberField('age', 'Возраст', '30', age, (next) => (age = next))}
				{@render numberField('heightCm', 'Рост, см', '175', heightCm, (next) => (heightCm = next))}
				{@render numberField('weightKg', 'Вес, кг', '70', weightKg, (next) => (weightKg = next))}
			</div>

			<div class="mt-6 flex gap-2">
				<button
					type="button"
					onclick={() => next('intro')}
					class="flex-1 rounded-full border border-line-strong py-3 text-sm font-medium
					       transition-transform duration-500 ease-flux active:scale-[0.98]"
				>
					Назад
				</button>
				<button
					type="button"
					onclick={goToActivity}
					class="flex-[1.4] rounded-full bg-lavender py-3 text-sm font-medium text-void
					       shadow-accent transition-transform duration-500 ease-flux active:scale-[0.98]"
				>
					Дальше
				</button>
			</div>
		{:else if step === 'activity'}
			<h1 class="text-xl font-semibold tracking-tight">Активность и цель</h1>
			<p class="mt-1.5 text-xs text-muted-foreground">Выберите то, что ближе к обычной неделе.</p>

			<div class="mt-4 flex flex-col gap-2">
				{#each Object.entries(ACTIVITY_LABELS) as [value, option] (value)}
					<button
						type="button"
						onclick={() => {
							telegram.haptic.selection();
							activity = value as ActivityLevel;
						}}
						aria-pressed={activity === value}
						class="flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left
						       transition-[transform,border-color] duration-500 ease-flux active:scale-[0.98]
						       {activity === value
							? 'border-lavender bg-lavender/[0.08]'
							: 'border-line/70 bg-white/[0.02]'}"
					>
						<span
							class="grid size-4 shrink-0 place-items-center rounded-full border
							       {activity === value ? 'border-lavender' : 'border-line-strong'}"
						>
							{#if activity === value}
								<span class="size-2 rounded-full bg-lavender"></span>
							{/if}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block text-sm">{option.title}</span>
							<span class="block text-xs text-muted-foreground">{option.hint}</span>
						</span>
					</button>
				{/each}
			</div>

			<p class="mt-5 mb-2 text-xs text-muted-foreground">Чего хотите добиться</p>
			<div class="flex gap-1.5">
				{#each Object.entries(GOAL_LABELS) as [value, option] (value)}
					<button
						type="button"
						onclick={() => {
							telegram.haptic.selection();
							goal = value as WeightGoal;
						}}
						aria-pressed={goal === value}
						class="flex-1 rounded-xl border px-2 py-2.5 text-xs transition-[transform,border-color,background-color]
						       duration-500 ease-flux active:scale-95
						       {goal === value
							? 'border-lavender bg-lavender/12 text-lavender'
							: 'border-line/70 bg-white/[0.02] text-muted-foreground'}"
					>
						{option.title}
					</button>
				{/each}
			</div>

			<div class="mt-6 flex gap-2">
				<button
					type="button"
					onclick={() => next('body')}
					class="flex-1 rounded-full border border-line-strong py-3 text-sm font-medium
					       transition-transform duration-500 ease-flux active:scale-[0.98]"
				>
					Назад
				</button>
				<button
					type="button"
					onclick={() => next('result')}
					class="flex-[1.4] rounded-full bg-lavender py-3 text-sm font-medium text-void
					       shadow-accent transition-transform duration-500 ease-flux active:scale-[0.98]"
				>
					Показать цели
				</button>
			</div>
		{:else if step === 'result' && preview}
			<div class="flex items-center gap-2">
				<Sparkle size={18} weight="light" class="text-lavender" />
				<h1 class="text-xl font-semibold tracking-tight">Ваши цели</h1>
			</div>
			<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
				Расчёт по формуле Миффлина–Сан Жеора. Это оценка: реальный расход отличается примерно на
				десятую часть, поэтому цели всегда можно поправить в настройках.
			</p>

			<div class="mt-5 rounded-card border border-line/70 bg-white/[0.02] p-4">
				<p class="tabular text-4xl leading-none font-semibold tracking-tight">
					{formatNumber(preview.calorieGoal)}
					<span class="text-base font-normal text-muted-foreground">ккал в день</span>
				</p>
				<p class="tabular mt-1.5 text-xs text-muted-foreground">
					Обмен в покое {formatNumber(preview.bmr)} · с активностью {formatNumber(preview.tdee)}
				</p>

				<div class="mt-4 grid grid-cols-3 gap-2">
					{#each [['Белки', preview.proteinGoal], ['Жиры', preview.fatGoal], ['Углеводы', preview.carbsGoal]] as [label, value] (label)}
						<div class="rounded-xl bg-white/[0.03] px-2 py-2.5 text-center">
							<p class="text-[11px] text-muted-foreground">{label}</p>
							<p class="tabular mt-0.5 text-sm font-medium">{value} г</p>
						</div>
					{/each}
				</div>

				<p class="tabular mt-3 text-xs text-muted-foreground">
					Вода: {formatNumber(preview.waterGoalMl)} мл в день
				</p>
			</div>

			<div class="mt-6 flex gap-2">
				<button
					type="button"
					onclick={() => next('activity')}
					class="flex-1 rounded-full border border-line-strong py-3 text-sm font-medium
					       transition-transform duration-500 ease-flux active:scale-[0.98]"
				>
					Изменить
				</button>
				<button
					type="button"
					onclick={apply}
					class="flex flex-[1.4] items-center justify-center gap-2 rounded-full bg-lavender py-3
					       text-sm font-medium text-void shadow-accent transition-transform duration-500
					       ease-flux active:scale-[0.98]"
				>
					<Check size={16} weight="bold" />
					Применить
				</button>
			</div>
		{:else if step === 'start'}
			<div class="flex items-center gap-2">
				<Check size={18} weight="bold" class="text-lavender" />
				<h1 class="text-xl font-semibold tracking-tight">Цели готовы</h1>
			</div>
			<p class="mt-1.5 mb-5 text-sm leading-relaxed text-muted-foreground">
				{formatNumber(plannerStore.doc.settings.calorieGoal)} ккал в день. Теперь одна запись — и будет
				с чем сравнивать.
			</p>

			<StartActions onpick={onclose} />

			<button
				type="button"
				onclick={onclose}
				class="mt-3 w-full rounded-full py-3 text-sm text-muted-foreground
				       transition-colors duration-400 ease-flux hover:text-foreground"
			>
				Позже
			</button>
		{/if}
	</div>
</div>
