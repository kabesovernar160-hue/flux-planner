<script lang="ts">
	import { ArrowCounterClockwise, Warning } from 'phosphor-svelte';
	import { page } from '$app/state';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { telegram } from '$lib/telegram';

	/**
	 * Своя страница ошибки.
	 *
	 * Дефолтная страница SvelteKit — чёрный текст на белом с английским
	 * «Internal Error»: внутри тёмного Mini App это выглядит как поломка
	 * самого Telegram. Здесь человек видит приложение, понятную причину
	 * и кнопку, которая в большинстве случаев всё чинит.
	 */

	const notFound = $derived(page.status === 404);

	const title = $derived(notFound ? 'Такой страницы нет' : 'Что-то пошло не так');

	const explanation = $derived(
		notFound
			? 'Возможно, ссылка устарела. Дневник и все записи на месте.'
			: 'Данные на устройстве не пострадали: они хранятся локально и никуда не делись.'
	);

	function reload(): void {
		telegram.haptic.impact('light');
		location.reload();
	}
</script>

<svelte:head>
	<title>{title} — Flux Planner</title>
</svelte:head>

<div class="flex flex-1 items-center justify-center">
	<GlassCard padding="lg" bezel class="w-full text-center">
		<div
			class="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-line-strong"
		>
			<Warning size={22} weight="light" class={notFound ? 'text-lavender' : 'text-destructive'} />
		</div>

		<h1 class="text-base font-semibold tracking-tight">{title}</h1>
		<p class="mt-2 text-xs leading-relaxed text-muted-foreground">{explanation}</p>

		{#if page.error?.message && !notFound}
			<!-- Текст ошибки с сервера уже безопасен для показа: подробности
			     остаются в логах, наружу уходит только описание и номер запроса,
			     по которому обращение находится в поддержке. -->
			<p
				class="mt-3 rounded-xl border border-line/70 bg-white/[0.02] px-3 py-2 text-xs text-muted-foreground"
			>
				{page.error.message}
			</p>
		{/if}

		<div class="mt-5 flex flex-col gap-2">
			<!-- На 404 обновление вернёт ту же страницу, поэтому кнопки меняются
			     местами: первой стоит та, что действительно решает проблему. -->
			{#if !notFound}
				<button
					type="button"
					onclick={reload}
					class="flex items-center justify-center gap-2 rounded-full bg-lavender py-2.5 text-xs
					       font-medium text-primary-foreground transition-transform duration-500 ease-flux
					       active:scale-[0.98]"
				>
					<ArrowCounterClockwise size={13} weight="light" />
					Обновить
				</button>
			{/if}

			<a
				href="/"
				onclick={() => telegram.haptic.impact('light')}
				class="rounded-full py-2.5 text-xs font-medium transition-[transform,border-color]
				       duration-500 ease-flux active:scale-[0.98]
				       {notFound
					? 'bg-lavender text-primary-foreground'
					: 'border border-line-strong hover:border-lavender/60'}"
			>
				На главную
			</a>
		</div>

		<p class="mt-4 text-[0.6875rem] text-muted-foreground/70">Код {page.status}</p>
	</GlassCard>
</div>
