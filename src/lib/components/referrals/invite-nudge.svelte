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
		<GlassCard padding="sm">
			<div class="flex items-center gap-3">
				<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-tone/12">
					<Gift size={17} weight="regular" class="text-tone" />
				</span>
				<p class="min-w-0 flex-1 text-xs leading-relaxed">
					Позовите друга — оба получите {referral.rewardDays}&nbsp;{pluralDays(referral.rewardDays)}
					Pro
				</p>
				<button
					type="button"
					onclick={share}
					aria-label="Поделиться приглашением"
					class="grid size-9 shrink-0 place-items-center rounded-full bg-lavender text-void
					       transition-transform duration-500 ease-flux active:scale-90"
				>
					<ShareFat size={15} weight="fill" />
				</button>
				<button
					type="button"
					onclick={close}
					aria-label="Скрыть приглашение"
					class="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground
					       transition-transform duration-500 ease-flux active:scale-90"
				>
					<X size={14} weight="light" />
				</button>
			</div>
		</GlassCard>
	</div>
{/if}
