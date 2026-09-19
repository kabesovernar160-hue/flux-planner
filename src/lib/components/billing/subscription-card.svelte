<script lang="ts">
	import { Check, Sparkle, Star } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { PLANS } from '$lib/billing/plans';
	import { billing } from '$lib/state/billing.svelte';
	import { telegram } from '$lib/telegram';

	/**
	 * Экран тарифа.
	 *
	 * Показывает, что уже есть, и чего не хватает — без обратного отсчёта,
	 * мигающих скидок и прочего давления. Человеку, который ведёт дневник
	 * питания, врать о лимитах особенно неуместно: он и так каждый день
	 * сверяет цифры.
	 */

	const pro = PLANS.pro;
	const free = PLANS.free;

	const expiresLabel = $derived.by(() => {
		if (!billing.expiresAt) return null;
		return new Date(billing.expiresAt).toLocaleDateString('ru-RU', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	});

	const scans = $derived(billing.scans);
</script>

<GlassCard>
	<div class="mb-3 flex items-center gap-2">
		<Sparkle size={16} weight="light" class="text-lavender" />
		<h2 class="flex-1 text-sm font-medium">
			{billing.isPro ? 'Flux Planner Pro' : 'Тариф'}
		</h2>
		<span
			class="rounded-full px-2.5 py-1 text-[11px]
			       {billing.isPro ? 'bg-lavender/12 text-lavender' : 'bg-white/[0.06] text-muted-foreground'}"
		>
			{billing.isPro ? 'активна' : free.title}
		</span>
	</div>

	{#if billing.status === 'unavailable'}
		<p class="py-1 text-sm leading-relaxed text-muted-foreground">
			Подписка оформляется внутри Telegram: там же проходит оплата звёздами.
		</p>
	{:else}
		{#if scans}
			<!--
				Остаток показывается всегда, а не только когда он кончился:
				узнать о лимите в момент, когда очень нужно распознать обед, —
				худший момент из возможных.
			-->
			<div class="mb-4 rounded-card border border-line/70 bg-white/[0.02] p-3.5">
				<div class="flex items-baseline gap-2">
					<p class="tabular text-2xl leading-none font-semibold">
						{scans.remaining}
						<span class="text-sm font-normal text-muted-foreground">из {scans.limit}</span>
					</p>
					<p class="flex-1 text-right text-xs text-muted-foreground">
						распознаваний по фото сегодня
					</p>
				</div>

				<div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line">
					<div
						class="h-full rounded-full transition-[width] duration-700 ease-flux
						       {scans.remaining === 0 ? 'bg-destructive' : 'bg-lavender'}"
						style="width: {scans.limit > 0 ? (scans.used / scans.limit) * 100 : 0}%"
					></div>
				</div>

				<p class="mt-2 text-[11px] text-muted-foreground">
					Счётчик обнуляется в полночь. Ручной ввод и поиск по справочнику не тратят его.
				</p>
			</div>
		{/if}

		{#if billing.isPro}
			<p class="text-sm leading-relaxed text-muted-foreground">
				{#if expiresLabel}
					Подписка действует до {expiresLabel} и продлевается автоматически. Отменить можно в настройках
					Telegram: «Настройки → Звёзды и подписки».
				{:else}
					Подписка активна.
				{/if}
			</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each pro.perks as perk (perk)}
					<li class="flex items-start gap-2.5 text-sm">
						<Check size={15} weight="bold" class="mt-0.5 shrink-0 text-lavender" />
						<span class="leading-relaxed">{perk}</span>
					</li>
				{/each}
			</ul>

			<button
				type="button"
				onclick={() => {
					telegram.haptic.impact('medium');
					void billing.subscribe();
				}}
				disabled={billing.purchase === 'creating' || billing.purchase === 'awaiting'}
				class="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-lavender py-3
				       text-sm font-medium text-void shadow-accent transition-transform duration-500
				       ease-flux hover:bg-lavender-hi active:scale-[0.98]
				       disabled:pointer-events-none disabled:opacity-60"
			>
				{#if billing.purchase === 'creating' || billing.purchase === 'awaiting'}
					Открываем оплату…
				{:else}
					<Star size={15} weight="fill" />
					{pro.stars} звёзд в месяц
				{/if}
			</button>

			<p class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
				Оплата звёздами Telegram, без карты. Подписка продлевается раз в 30 дней, отменяется в любой
				момент в настройках Telegram.
			</p>

			{#if billing.error}
				<p class="mt-2 text-xs text-destructive">{billing.error}</p>
			{/if}

			{#if billing.purchase === 'cancelled'}
				<p class="mt-2 text-xs text-muted-foreground">Оплата отменена — тариф не изменился.</p>
			{/if}
		{/if}
	{/if}
</GlassCard>
