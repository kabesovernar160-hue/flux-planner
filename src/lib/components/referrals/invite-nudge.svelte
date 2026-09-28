<script lang="ts">
	import { Gift, ShareFat, X } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { shareInvite } from '$lib/services/referralService';
	import { referral } from '$lib/state/referrals.svelte';
	import { telegram } from '$lib/telegram';
	import { shouldShowInviteNudge } from '$lib/utils/inviteNudge';
	import { pluralDays } from '$lib/utils/format';

	/**
	 * Отметка закрытия — в localStorage этого устройства.
	 *
	 * Это не настройка, а ненавязчивость: если Telegram почистит хранилище,
	 * карточка просто покажется чуть раньше. Синхронизировать её между
	 * устройствами ради этого незачем.
	 */
	const STORAGE_KEY = 'fx-invite-nudge-dismissed';

	function readDismissed(): string | null {
		try {
			return localStorage.getItem(STORAGE_KEY);
		} catch {
			return null;
		}
	}

	let dismissedAt = $state<string | null>(readDismissed());

	function dismiss() {
		dismissedAt = new Date().toISOString();
		try {
			localStorage.setItem(STORAGE_KEY, dismissedAt);
		} catch {
			// Приватный режим: карточка скроется до перезагрузки экрана.
		}
	}

	$effect(() => {
		if (telegram.isReady) void referral.refresh();
	});

	const visible = $derived(
		referral.status === 'ready' &&
			referral.link !== null &&
			shouldShowInviteNudge(dismissedAt, new Date(), referral.capReached)
	);

	function share() {
		if (!referral.link) return;
		shareInvite(referral.link);
		// Поделился — значит, увидел: напоминать на следующей неделе, не завтра.
		dismiss();
	}

	function close() {
		telegram.haptic.impact('light');
		dismiss();
	}
</script>

{#if visible}
	<div class="fx-rise mb-4" style="--fx-step: 1;">
		<!--
			Лаванда, а не тон раздела: приглашение — про сам продукт и Pro,
			это цвет бренда. Лёгкий лавандовый отлив слева отличает карточку
			от разделов аналитики, но не спорит с ними за внимание.
		-->
		<GlassCard padding="sm">
			<span
				aria-hidden="true"
				class="pointer-events-none absolute -inset-y-3.5 -left-3.5 w-2/3 bg-gradient-to-r from-lavender/[0.09] to-transparent"
			></span>
			<div class="relative flex items-center gap-3">
				<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-lavender/12">
					<Gift size={17} weight="regular" class="text-lavender" />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">Позовите друга</p>
					<p class="mt-0.5 text-xs text-muted-foreground">
						Оба получите {referral.rewardDays}&nbsp;{pluralDays(referral.rewardDays)} Pro
					</p>
				</div>
				<button
					type="button"
					onclick={share}
					aria-label="Поделиться приглашением"
					class="grid size-10 shrink-0 place-items-center rounded-full bg-lavender text-void
					       shadow-accent transition-transform duration-500 ease-flux hover:bg-lavender-hi
					       active:scale-90"
				>
					<ShareFat size={16} weight="fill" />
				</button>
				<!-- size-10: рядом другая кнопка, и промах по крестику отправил бы приглашение. -->
				<button
					type="button"
					onclick={close}
					aria-label="Скрыть приглашение"
					class="-mr-1 grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground
					       transition-transform duration-500 ease-flux active:scale-90"
				>
					<X size={15} weight="light" />
				</button>
			</div>
		</GlassCard>
	</div>
{/if}
