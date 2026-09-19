<script lang="ts">
	import { page } from '$app/state';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { activeTab, TABS, type Tab } from './tabs';
	import { telegram } from '$lib/telegram';

	type Props = {
		oncreate?: () => void;
	};

	let { oncreate }: Props = $props();

	// Активный пункт выводится из адреса, а не хранится отдельно: иначе
	// переход «назад» в Telegram рассинхронизировал бы панель со страницей.
	const active = $derived(activeTab(page.url.pathname));

	function create() {
		telegram.haptic.impact('medium');
		oncreate?.();
	}
</script>

{#snippet tabButton(tab: Tab)}
	{@const Icon = tab.icon}
	{@const isActive = tab.href === active}
	<!--
		aria-label задан явно: подпись лежит в span рядом с иконкой, и дерево
		доступности не собирало из неё имя кнопки — таб читался скринридером
		как безымянный.
	-->
	<!--
		Ссылка, а не кнопка: переход между разделами — это смена адреса,
		и нативное поведение (предзагрузка, история, открытие в новой вкладке
		в десктопном Telegram) достаётся бесплатно.
	-->
	<a
		href={tab.href}
		onclick={() => telegram.haptic.impact('light')}
		aria-label={tab.label}
		aria-current={isActive ? 'page' : undefined}
		class="relative flex flex-col items-center gap-1 py-3
		       transition-transform duration-500 ease-flux active:scale-95"
	>
		{#if isActive}
			<span
				class="pointer-events-none absolute top-1.5 size-9 rounded-full"
				style="background: radial-gradient(circle, oklch(0.7022 0.1527 293.82 / 0.22), transparent 70%);"
			></span>
		{/if}

		<!--
			Активный таб переключается на weight="fill". Это не нарушает правило
			единой толщины линий: заливка здесь работает как состояние,
			а не как вторая иконочная семья.
		-->
		<Icon
			size={21}
			weight={isActive ? 'fill' : 'light'}
			class="relative transition-colors duration-400 ease-flux
			       {isActive ? 'text-lavender' : 'text-muted-foreground'}"
		/>
		<span
			class="text-[9.5px] leading-none transition-colors duration-400 ease-flux
			       {isActive ? 'text-lavender' : 'text-muted-foreground'}"
		>
			{tab.label}
		</span>
	</a>
{/snippet}

<!--
	Слой навигации. z-40 — единственный системный уровень, который здесь нужен;
	произвольные z-50 по компонентам не раздаём.
	pointer-events-none на обёртке, чтобы прозрачные поля по краям
	не перехватывали тапы по контенту под панелью.
-->
<div class="pointer-events-none fixed inset-x-0 bottom-0 z-40">
	<div
		class="mx-auto w-full max-w-md"
		style="
			padding-left: calc(var(--fx-safe-left) + 1rem);
			padding-right: calc(var(--fx-safe-right) + 1rem);
			padding-bottom: calc(var(--fx-safe-bottom) + 0.75rem);
		"
	>
		<div class="pointer-events-auto relative">
			<!--
				blur включён осознанно: панель зафиксирована и не участвует
				в скролле, поэтому backdrop-filter пересчитывается редко.
				Это ровно тот случай, для которого проп и задумывался.
			-->
			<GlassCard blur radius="full" padding="none">
				<nav class="grid grid-cols-5 items-center" aria-label="Основная навигация">
					{#each TABS.slice(0, 2) as tab (tab.href)}
						{@render tabButton(tab)}
					{/each}

					<!-- Пустая центральная колонка держит место под FAB. -->
					<div aria-hidden="true"></div>

					{#each TABS.slice(2) as tab (tab.href)}
						{@render tabButton(tab)}
					{/each}
				</nav>
			</GlassCard>

			<!--
				FAB вынесена из GlassCard: у карточки overflow-hidden, внутри
				кнопка обрезалась бы по краю панели и перестала выступать.
			-->
			<button
				type="button"
				onclick={create}
				aria-label="Создать запись"
				class="absolute -top-5 left-1/2 grid size-14 -translate-x-1/2 place-items-center
				       rounded-full border border-white/15 bg-lavender text-void
				       transition-transform duration-500 ease-flux hover:bg-lavender-hi
				       active:scale-90"
				style="box-shadow: 0 10px 30px -8px oklch(0.7022 0.1527 293.82 / 0.6);"
			>
				<svg
					viewBox="0 0 24 24"
					class="size-6"
					fill="none"
					stroke="currentColor"
					stroke-width="2.25"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M12 5v14M5 12h14" />
				</svg>
			</button>
		</div>
	</div>
</div>
