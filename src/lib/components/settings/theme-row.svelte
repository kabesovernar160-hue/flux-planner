<script lang="ts">
	import { Palette } from 'phosphor-svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { normalizeThemePreference, type ThemePreference } from '$lib/theme';

	/**
	 * Выбор темы — строка оглавления настроек.
	 *
	 * Хранится в настройках, а не только на устройстве: светлую тему,
	 * выбранную на телефоне, человек ждёт увидеть и на планшете.
	 * На экран её выводит $lib/theme, здесь только запись выбора.
	 *
	 * Отдельного экрана нет: три варианта переключаются прямо здесь,
	 * и заходить ради них внутрь было бы лишним шагом.
	 */
	const current = $derived(normalizeThemePreference(plannerStore.doc.settings.theme));

	// Вне Telegram «авто» следует системной теме, и подпись это говорит.
	const OPTIONS = $derived<{ value: ThemePreference; label: string }[]>([
		{ value: 'auto', label: telegram.isEmbedded ? 'Как в Telegram' : 'Как в системе' },
		{ value: 'light', label: 'Светлая' },
		{ value: 'dark', label: 'Тёмная' }
	]);

	function choose(value: ThemePreference) {
		if (value === current) return;
		telegram.haptic.selection();
		// «Как в Telegram» — это отсутствие поля: так настройка выглядит
		// и у тех, кто её никогда не трогал.
		plannerStore.updateSettings({ theme: value === 'auto' ? undefined : value });
	}
</script>

<!--
	Геометрия как у SettingsRow: чип иконки слева, разделитель от подписи.
	Подпись и переключатель в одну строку не помещались: «Как в Telegram»
	на ширине телефона наезжало на подпись. Переключатель — во всю ширину
	под ней, варианты делят её поровну.
-->
<div class="group/row relative flex w-full items-start gap-3 pl-4">
	<span class="mt-3 grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
		<Palette size={15} weight="regular" class="text-tone" />
	</span>

	<div
		class="flex min-w-0 flex-1 flex-col gap-2.5 self-stretch border-t border-line/60 py-3 pr-4
		       group-first/row:border-t-0"
	>
		<span id="theme-label" class="flex min-h-7 items-center text-sm">Тема</span>

		<div
			role="radiogroup"
			aria-labelledby="theme-label"
			class="flex gap-0.5 rounded-full border border-line-strong p-0.5"
		>
			{#each OPTIONS as option (option.value)}
				{@const active = option.value === current}
				<button
					type="button"
					role="radio"
					aria-checked={active}
					onclick={() => choose(option.value)}
					class="min-h-9 flex-1 rounded-full px-2 py-1.5 text-xs whitespace-nowrap
					       transition-[background-color,color,transform] duration-400 ease-flux active:scale-95
					       {active ? 'bg-tone/12 font-medium text-tone' : 'text-muted-foreground'}"
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>
</div>
