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
		class="relative flex min-w-0 flex-col items-center gap-1 py-2
		       transition-transform duration-500 ease-flux active:scale-95"
	>
		<!-- Высота панели держится ≈59px: под неё рассчитан нижний отступ в +layout.svelte. -->
		<span class="relative grid h-7 w-12 place-items-center">
			{#if isActive}
				<!--
					Плашка шире иконки: активный таб читается силуэтом, а не только
					цветом, — это важно при дальтонизме и на ярком солнце. Появляется
					с короткой отдачей, в покое не шевелится.
				-->
				<span
					class="fx-pop pointer-events-none absolute inset-0 rounded-full bg-lavender/14
					       shadow-[inset_0_1px_0_0_var(--fx-glass-highlight)]"
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
		</span>
		<!--
			11px — нижняя граница читаемого на телефоне. «Календарь» и «Настройки»
			на узком экране (320px) влезают впритык, поэтому там поджат трекинг
			и поля панели, а не уменьшен размер.
		-->
		<span
			class="max-w-full truncate text-[11px] leading-none tracking-[-0.01em]
			       transition-colors duration-400
			       ease-flux max-[359px]:tracking-[-0.035em]
			       {isActive ? 'font-medium text-lavender' : 'text-muted-foreground'}"
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
		class="mx-auto w-full max-w-md [--fx-nav-gutter:1rem] max-[359px]:[--fx-nav-gutter:0.5rem]"
		style="
			padding-left: calc(var(--fx-safe-left) + var(--fx-nav-gutter));
			padding-right: calc(var(--fx-safe-right) + var(--fx-nav-gutter));
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
				       rounded-full border border-white/20 text-on-accent
				       transition-transform duration-500 ease-flux active:scale-90"
				style="
					background: linear-gradient(180deg, var(--fx-lavender-hi), var(--fx-lavender) 60%, var(--fx-lavender-lo));
					box-shadow:
						inset 0 1px 0 0 var(--fx-fab-highlight),
						0 0 0 4px var(--fx-void),
						var(--fx-shadow-fab);
				"
			>
				<!--
					Кольцо цвета фона вокруг кнопки вырезает её из панели: FAB
					читается как отдельный предмет над стеклом, а не как наклейка
					на нём. Градиент сверху вниз и блик по кромке — тот же свет,
					что и у карточек.
				-->
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
