<script lang="ts">
	import { Camera, CaretRight, CheckCircle, Plus, Wallet } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { HABIT_PRESETS, habitIcon } from '$lib/icons/habit-icons';
	import { createHabit } from '$lib/services/habitService';
	import { ui } from '$lib/state/ui.svelte';
	import { telegram } from '$lib/telegram';

	type Props = {
		/**
		 * Вызывается перед любым действием.
		 *
		 * Онбординг закрывает себя здесь: шторка или новая привычка должны
		 * оказаться перед глазами, а не под слоем приветствия.
		 */
		onpick?: () => void;
		/** Первый шаг лесенки появления: блок встраивается ниже других элементов экрана. */
		step?: number;
	};

	let { onpick, step = 0 }: Props = $props();

	function scanFood() {
		onpick?.();
		ui.openFoodSheet();
	}

	function addExpense() {
		onpick?.();
		ui.openFinanceSheet(undefined, 'expense');
	}

	/**
	 * Готовая привычка создаётся сразу, без формы.
	 *
	 * Форма из названия, иконки и расписания — три решения там, где
	 * новичок хочет сделать одно. Расписание «каждый день» правится потом
	 * на экране привычек, если понадобится.
	 */
	function addPreset(name: string, icon: string) {
		onpick?.();
		const result = createHabit({ name, icon, frequency: 'daily' });
		if (result.ok) telegram.haptic.notification('success');
	}

	function customHabit() {
		onpick?.();
		ui.openHabitSheet();
	}
</script>

<!--
	Три действия, по одному на раздел, в его тоне: человек с первого экрана
	привыкает, что еда — янтарная, привычки — мятные, деньги — голубые,
	и потом находит их на дашборде боковым зрением.
-->
<div class="flex flex-col gap-3">
	<div class="fx-rise" style="--fx-step: {step};">
		<GlassCard tone="amber" onclick={scanFood} aria-label="Сфоткать еду">
			<span class="flex items-center gap-3.5">
				<span class="grid size-11 shrink-0 place-items-center rounded-xl bg-tone/12">
					<Camera size={22} weight="light" class="text-tone" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block text-base font-medium">Сфоткать еду</span>
					<span class="block text-xs leading-relaxed text-muted-foreground">
						Калории посчитаются по фото
					</span>
				</span>
				<CaretRight size={16} weight="light" class="shrink-0 text-muted-foreground" />
			</span>
		</GlassCard>
	</div>

	<div class="fx-rise" style="--fx-step: {step + 1};">
		<GlassCard tone="mint">
			<div class="mb-3 flex items-center gap-3.5">
				<span class="grid size-11 shrink-0 place-items-center rounded-xl bg-tone/12">
					<CheckCircle size={22} weight="light" class="text-tone" />
				</span>
				<div class="min-w-0 flex-1">
					<h3 class="text-base font-medium">Добавить привычку</h3>
					<p class="text-xs leading-relaxed text-muted-foreground">
						Одно касание — и она уже на главной
					</p>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-2">
				{#each HABIT_PRESETS as preset (preset.name)}
					{@const Icon = habitIcon(preset.icon)}
					<button
						type="button"
						onclick={() => addPreset(preset.name, preset.icon)}
						class="flex items-center gap-2 rounded-xl border border-line/70 bg-white/[0.02] px-3
						       py-3 text-left transition-[transform,border-color] duration-500 ease-flux
						       hover:border-tone/60 active:scale-[0.97]"
					>
						<Icon size={17} weight="light" class="shrink-0 text-tone" />
						<span class="min-w-0 flex-1 truncate text-sm">{preset.name}</span>
						<Plus size={12} weight="bold" class="shrink-0 text-muted-foreground" />
					</button>
				{/each}
			</div>

			<button
				type="button"
				onclick={customHabit}
				class="mt-2 w-full rounded-full py-2 text-xs text-muted-foreground
				       transition-colors duration-400 ease-flux hover:text-foreground"
			>
				Своя привычка
			</button>
		</GlassCard>
	</div>

	<div class="fx-rise" style="--fx-step: {step + 2};">
		<GlassCard tone="sky" onclick={addExpense} aria-label="Записать трату">
			<span class="flex items-center gap-3.5">
				<span class="grid size-11 shrink-0 place-items-center rounded-xl bg-tone/12">
					<Wallet size={22} weight="light" class="text-tone" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block text-base font-medium">Записать трату</span>
					<span class="block text-xs leading-relaxed text-muted-foreground">
						Два поля: сумма и категория
					</span>
				</span>
				<CaretRight size={16} weight="light" class="shrink-0 text-muted-foreground" />
			</span>
		</GlassCard>
	</div>
</div>
