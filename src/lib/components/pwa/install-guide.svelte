<script lang="ts">
	import {
		Check,
		DotsThreeVertical,
		DownloadSimple,
		Export,
		PlusSquare,
		type IconComponentProps
	} from 'phosphor-svelte';
	import type { Component } from 'svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { pwa } from '$lib/pwa/pwa.svelte';

	type Props = {
		/** Шаг лесенки появления (--fx-step). */
		step?: number;
	};

	let { step = 0 }: Props = $props();

	/**
	 * «Добавьте на главный экран».
	 *
	 * У айфона нет кнопки установки, которую сайт мог бы нажать за человека:
	 * только меню «Поделиться» в Safari. Поэтому для iOS — три шага словами
	 * и теми же значками, что человек увидит на экране. Chrome на Android
	 * умеет показать своё окно установки — тогда это одна кнопка, а если
	 * окна нет (уже установлено или браузер не умеет), — путь через меню.
	 */

	interface GuideStep {
		icon: Component<IconComponentProps>;
		text: string;
	}

	const iosSteps = $derived<GuideStep[]>(
		pwa.iosOtherBrowser
			? [
					{ icon: Export, text: 'Нажмите «Поделиться» в адресной строке' },
					{ icon: PlusSquare, text: 'Выберите «На экран „Домой“»' },
					{ icon: Check, text: 'Нажмите «Добавить»' }
				]
			: [
					{ icon: Export, text: 'Нажмите «Поделиться» внизу экрана Safari' },
					{ icon: PlusSquare, text: 'Пролистайте и выберите «На экран „Домой“»' },
					{ icon: Check, text: 'Нажмите «Добавить» — иконка Flux появится на экране' }
				]
	);

	const androidSteps: GuideStep[] = [
		{ icon: DotsThreeVertical, text: 'Откройте меню браузера ⋮' },
		{
			icon: DownloadSimple,
			text: 'Выберите «Установить приложение» или «Добавить на главный экран»'
		}
	];

	let installing = $state(false);

	async function install() {
		installing = true;
		await pwa.install();
		installing = false;
	}
</script>

<GlassCard class="fx-rise" style="--fx-step: {step}">
	<div class="mb-3 flex items-center gap-2.5">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<PlusSquare size={15} weight="regular" class="text-tone" />
		</span>
		<h2 class="flex-1 text-sm font-medium">Добавьте на главный экран</h2>
	</div>

	{#if pwa.installed}
		<p class="text-sm leading-relaxed text-pretty text-muted-foreground">
			Готово — Flux на главном экране. Открывайте его оттуда: без адресной строки и без Telegram.
		</p>
	{:else if pwa.platform === 'ios'}
		<p class="mb-3 text-sm leading-relaxed text-pretty text-muted-foreground">
			Flux откроется с главного экрана как обычное приложение — без адресной строки и без Telegram.
		</p>
		<ol class="flex flex-col gap-2.5">
			{#each iosSteps as item, index (item.text)}
				{@const Icon = item.icon}
				<li class="flex items-center gap-3">
					<span
						class="tabular grid size-7 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-xs
						       text-muted-foreground"
					>
						{index + 1}
					</span>
					<span class="min-w-0 flex-1 text-sm">{item.text}</span>
					<Icon size={20} weight="light" class="shrink-0 text-lavender" />
				</li>
			{/each}
		</ol>
		<p class="mt-3 border-t border-line/60 pt-3 text-xs leading-relaxed text-muted-foreground">
			Если приложение на экране попросит войти ещё раз, возьмите у бота новый код — этот уже
			использован.
		</p>
	{:else if pwa.canPrompt}
		<p class="mb-3 text-sm leading-relaxed text-pretty text-muted-foreground">
			Flux встанет рядом с остальными приложениями и будет открываться без адресной строки и без
			Telegram.
		</p>
		<button
			type="button"
			onclick={install}
			disabled={installing}
			class="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-lavender text-sm
			       font-medium text-on-accent shadow-accent transition-transform duration-500 ease-flux
			       active:scale-[0.98] disabled:opacity-60"
		>
			<DownloadSimple size={16} weight="bold" />
			Установить приложение
		</button>
	{:else}
		<p class="mb-3 text-sm leading-relaxed text-pretty text-muted-foreground">
			{pwa.platform === 'android'
				? 'Flux встанет рядом с остальными приложениями и будет открываться без адресной строки.'
				: 'Удобнее всего — на телефоне. На компьютере приложение ставится из меню браузера.'}
		</p>
		<ol class="flex flex-col gap-2.5">
			{#each androidSteps as item, index (item.text)}
				{@const Icon = item.icon}
				<li class="flex items-center gap-3">
					<span
						class="tabular grid size-7 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-xs
						       text-muted-foreground"
					>
						{index + 1}
					</span>
					<span class="min-w-0 flex-1 text-sm">{item.text}</span>
					<Icon size={20} weight="light" class="shrink-0 text-lavender" />
				</li>
			{/each}
		</ol>
	{/if}
</GlassCard>
