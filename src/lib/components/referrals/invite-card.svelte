<script lang="ts">
	import { Check, Copy, Gift, ShareFat } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { copyInvite, shareInvite } from '$lib/services/referralService';
	import { referral } from '$lib/state/referrals.svelte';
	import { telegram } from '$lib/telegram';
	import { pluralDays } from '$lib/utils/format';

	// Эффект компонента срабатывает раньше эффекта разметки, который
	// поднимает Telegram. Без ожидания готовности запрос ушёл бы без подписи,
	// и карточка навсегда решила бы, что открыта вне Telegram.
	$effect(() => {
		if (telegram.isReady) void referral.refresh();
	});

	/** «Скопировано» держится пару секунд: достаточно, чтобы заметить. */
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;

	async function copy() {
		if (!referral.link) return;
		copied = await copyInvite(referral.link);
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 2000);
	}

	$effect(() => () => {
		if (copiedTimer) clearTimeout(copiedTimer);
	});
</script>

<!--
	Лаванда, а не тон раздела: приглашение про Pro и про само приложение,
	а не про еду, привычки или деньги.
-->
<GlassCard id="invite-card">
	<div class="mb-1 flex items-center gap-2">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<Gift size={15} weight="regular" class="text-tone" />
		</span>
		<h2 class="flex-1 text-sm font-medium">Позвать друга</h2>
	</div>

	<!-- Неразрывные пробелы: число без слова «дней» на соседней строке читается как опечатка. -->
	<p class="py-1 text-xs leading-relaxed text-muted-foreground">
		Друг получит {referral.rewardDays}&nbsp;{pluralDays(referral.rewardDays)} Pro после первой записи,
		вы&nbsp;— {referral.rewardDays}&nbsp;{pluralDays(referral.rewardDays)} за каждого, до {referral.capDays}&nbsp;дней.
	</p>

	{#if referral.status === 'unavailable'}
		<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
			Ссылка появится, когда приложение открыто из Telegram: приглашение привязано к аккаунту.
		</p>
	{:else if referral.status !== 'ready' || !referral.link}
		<!-- Заглушка той же высоты, что и ссылка: экран не прыгает, когда она приходит. -->
		<div class="mt-2 h-10 animate-pulse rounded-xl bg-white/[0.04]" aria-hidden="true"></div>
	{:else}
		<p
			data-selectable
			class="mt-2 truncate rounded-xl border border-line/70 bg-white/[0.03] px-3 py-2.5 text-xs
			       text-foreground/90"
		>
			{referral.link}
		</p>

		<div class="mt-3 grid grid-cols-[1.4fr_1fr] gap-2">
			<button
				type="button"
				onclick={() => referral.link && shareInvite(referral.link)}
				class="flex items-center justify-center gap-2 rounded-full bg-lavender py-2.5 text-sm
				       font-medium text-void shadow-accent transition-transform duration-500 ease-flux
				       hover:bg-lavender-hi active:scale-[0.98]"
			>
				<ShareFat size={15} weight="fill" />
				Поделиться
			</button>
			<button
				type="button"
				onclick={copy}
				class="flex items-center justify-center gap-2 rounded-full border border-line-strong py-2.5
				       text-sm font-medium transition-[transform,border-color] duration-500 ease-flux
				       hover:border-lavender/60 active:scale-[0.98]"
			>
				{#if copied}
					<Check size={15} weight="bold" class="text-lavender" />
					Скопировано
				{:else}
					<Copy size={15} weight="light" />
					Скопировать
				{/if}
			</button>
		</div>

		<!-- Счётчик — не соревнование, а отчёт: сколько засчитано и что это дало. -->
		<p class="mt-4 border-t border-line/70 pt-3 text-xs text-muted-foreground">
			приглашено <span class="fx-num text-sm text-foreground">{referral.invited}</span>
			· получено
			<span class="fx-num text-sm text-foreground">{referral.earnedDays}</span>
			{pluralDays(referral.earnedDays)} Pro
		</p>

		{#if referral.pending > 0}
			<p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
				Пришли по ссылке и пока ничего не записали: {referral.pending}. Дни придут после их первой
				записи.
			</p>
		{/if}

		{#if referral.capReached}
			<p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
				Лимит {referral.capDays} дней набран. Друзья по-прежнему получают свои {referral.rewardDays}
				{pluralDays(referral.rewardDays)}.
			</p>
		{/if}
	{/if}
</GlassCard>
