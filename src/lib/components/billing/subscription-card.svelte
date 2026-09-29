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
	 *
	 * Компонент отдаёт несколько карточек подряд, а не одну: на своём экране
	 * тарифу есть где развернуться, и «что у меня сейчас» отделено от
	 * «что даст Pro» — это два разных вопроса.
	 */

	type Props = { step?: number };
	let { step = 0 }: Props = $props();

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
	const busy = $derived(billing.purchase === 'creating' || billing.purchase === 'awaiting');
</script>

<GlassCard bezel class="fx-rise" style="--fx-step: {step}">
	<div class="mb-3 flex items-center gap-2">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<Sparkle size={15} weight="regular" class="text-tone" />
		</span>
		<h2 class="flex-1 text-sm font-medium">
			{billing.isPro ? 'Flux Planner Pro' : 'Сейчас у вас'}
		</h2>
		<span
			class="rounded-full px-2.5 py-1 text-[11px] font-medium
			       {billing.isPro ? 'bg-lavender text-on-accent' : 'bg-ink/[0.06] text-muted-foreground'}"
		>
			{billing.isPro ? 'активна' : free.title}
		</span>
	</div>

	{#if billing.status === 'unavailable'}
		<p class="text-sm leading-relaxed text-muted-foreground">
			Подписка оформляется внутри Telegram: там же проходит оплата звёздами.
		</p>
	{:else}
		{#if scans}
			<!--
				Остаток показывается всегда, а не только когда он кончился:
				узнать о лимите в момент, когда очень нужно распознать обед, —
				худший момент из возможных.
			-->
			<div class="flex items-end gap-3">
				<p class="flex items-baseline gap-1.5">
					<span
						class="fx-num text-3xl leading-none {scans.remaining === 0 ? 'text-destructive' : ''}"
					>
						{scans.remaining}
					</span>
					<span class="tabular text-sm text-muted-foreground">из {scans.limit}</span>
				</p>
				<p class="flex-1 pb-0.5 text-right text-xs text-muted-foreground">
					распознаваний по фото осталось сегодня
				</p>
			</div>

			<!--
				Полоска показывает остаток, а не расход: она должна говорить
				то же, что крупная цифра рядом, иначе полная полоска при нуле
				использованных читается как «всё потрачено».
			-->
			<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
				<div
					class="h-full rounded-full bg-tone transition-[width] duration-500 ease-flux"
					style="width: {scans.limit > 0 ? (scans.remaining / scans.limit) * 100 : 0}%"
				></div>
			</div>

			<p class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
				Счётчик обнуляется в полночь. Ручной ввод и поиск по справочнику не тратят его.
			</p>
		{/if}

		{#if billing.isPro}
			<p
				class="text-sm leading-relaxed text-muted-foreground
				       {scans ? 'mt-4 border-t border-line/60 pt-3' : ''}"
			>
				{#if expiresLabel}
					Подписка действует до {expiresLabel} и продлевается автоматически. Отменить можно в настройках
					Telegram или написав боту «отмена» — оплаченный период при этом останется.
				{:else}
					Подписка активна.
				{/if}
			</p>
		{/if}
	{/if}
</GlassCard>

<!--
	Что даёт Pro, видно и вне Telegram: сюда ведут «Посмотреть тариф»
	из календаря и аналитики, и экран с одной фразой не ответил бы
	на вопрос, ради которого человек пришёл. Кнопка оплаты — только там,
	где оплата возможна.
-->
{#if !billing.isPro}
	<GlassCard class="fx-rise" style="--fx-step: {step + 1}">
		<h2 class="mb-3 text-sm font-medium">Что даёт Pro</h2>

		<ul class="flex flex-col gap-2.5">
			{#each pro.perks as perk (perk)}
				<li class="flex items-start gap-2.5 text-sm">
					<Check size={15} weight="bold" class="mt-0.5 shrink-0 text-tone" />
					<span class="leading-relaxed">{perk}</span>
				</li>
			{/each}
		</ul>

		{#if billing.status !== 'unavailable'}
			<button
				type="button"
				onclick={() => {
					telegram.haptic.impact('medium');
					void billing.subscribe();
				}}
				disabled={busy}
				class="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-lavender
			       text-sm font-medium text-on-accent shadow-accent transition-transform duration-500
			       ease-flux hover:bg-lavender-hi active:scale-[0.98]
			       disabled:pointer-events-none disabled:opacity-60"
			>
				{#if busy}
					Открываем оплату…
				{:else}
					<Star size={15} weight="fill" />
					{pro.stars} звёзд в месяц
				{/if}
			</button>

			<p class="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
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
	</GlassCard>
{/if}

<!--
	Бесплатное — тоже список, а не мелкий шрифт: человек должен видеть,
	что дневник целиком работает и без оплаты, и решать спокойно.
-->
{#if !billing.isPro}
	<GlassCard padding="sm" class="fx-rise" style="--fx-step: {step + 2}">
		<h2 class="mb-2 px-1.5 text-xs text-muted-foreground">Уже есть бесплатно</h2>
		<ul class="flex flex-col gap-1.5 px-1.5">
			{#each free.perks as perk (perk)}
				<li class="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
					<Check size={13} weight="light" class="mt-0.5 shrink-0" />
					<span>{perk}</span>
				</li>
			{/each}
		</ul>
	</GlassCard>
{/if}
