<script lang="ts">
	import { Palette } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { normalizeThemePreference, type ThemePreference } from '$lib/theme';

	/**
	 * Выбор темы — одна строка.
	 *
	 * Хранится в настройках, а не только на устройстве: светлую тему,
	 * выбранную на телефоне, человек ждёт увидеть и на планшете.
	 * На экран её выводит $lib/theme, здесь только запись выбора.
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

<GlassCard padding="sm">
	<div class="flex items-center gap-3 px-1.5">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<Palette size={15} weight="regular" class="text-tone" />
		</span>
		<span id="theme-label" class="min-w-0 flex-1 text-sm font-medium">Тема</span>

		<div
			role="radiogroup"
			aria-labelledby="theme-label"
			class="flex shrink-0 gap-0.5 rounded-full border border-line-strong p-0.5"
		>
			{#each OPTIONS as option (option.value)}
				{@const active = option.value === current}
				<button
					type="button"
					role="radio"
					aria-checked={active}
					onclick={() => choose(option.value)}
					class="rounded-full px-2.5 py-1.5 text-xs whitespace-nowrap
					       transition-[background-color,color,transform] duration-400 ease-flux active:scale-95
					       {active ? 'bg-tone/12 font-medium text-tone' : 'text-muted-foreground'}"
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>
</GlassCard>
