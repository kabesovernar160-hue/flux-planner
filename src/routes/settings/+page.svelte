<script lang="ts">
	import {
		BellSimple,
		ChartBar,
		Database,
		DeviceMobile,
		Gift,
		Info,
		Lightning,
		Sparkle,
		Target,
		Trash,
		Wallet
	} from 'phosphor-svelte';
	import ProfileCard from '$lib/components/settings/profile-card.svelte';
	import SettingsGroup from '$lib/components/settings/settings-group.svelte';
	import SettingsRow from '$lib/components/settings/settings-row.svelte';
	import { syncShortLabel } from '$lib/components/settings/sync-label';
	import ThemeRow from '$lib/components/settings/theme-row.svelte';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { syncQueue } from '$lib/db/syncQueue.svelte';
	import { billing } from '$lib/state/billing.svelte';
	import { referral } from '$lib/state/referrals.svelte';
	import { session } from '$lib/state/session.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { formatMoney, formatNumber, pluralDays } from '$lib/utils/format';

	/**
	 * Корень настроек — оглавление, а не склад.
	 *
	 * Раньше все разделы жили на одной странице длиной в семь экранов:
	 * чтобы поменять валюту, приходилось пролистать цели, тариф и
	 * приглашение. Теперь здесь только строки с текущим значением справа —
	 * по ним видно, что стоит, не заходя внутрь, — а сами настройки
	 * открываются отдельными экранами.
	 */

	const settings = $derived(plannerStore.doc.settings);

	const dailySummaryOn = $derived(settings.notifications?.dailySummary !== false);

	const inviteValue = $derived(
		referral.status === 'ready' && referral.invited > 0
			? `приглашено ${referral.invited}`
			: `+${referral.rewardDays} ${pluralDays(referral.rewardDays)} Pro`
	);
</script>

<PageHeader title="Настройки" />

<div class="flex flex-col gap-4">
	<ProfileCard step={0} />

	<SettingsGroup step={1}>
		<SettingsRow
			href="/settings/profile"
			icon={Target}
			tone="amber"
			label="Профиль и цели"
			value="{formatNumber(plannerStore.todayNutrition.calorieGoal)} ккал"
		/>
		<SettingsRow
			href="/settings/notifications"
			icon={BellSimple}
			tone="mint"
			label="Уведомления"
			value={dailySummaryOn ? 'Включены' : 'Выключены'}
		/>
		<SettingsRow
			href="/settings/money"
			icon={Wallet}
			tone="sky"
			label="Деньги"
			value="{formatMoney(plannerStore.todayFinance.budget, settings.currency)} в день"
		/>
		<!-- Тема переключается прямо здесь: ради трёх вариантов экран не нужен. -->
		<ThemeRow />
	</SettingsGroup>

	<SettingsGroup step={2}>
		<SettingsRow
			href="/settings/plan"
			icon={Sparkle}
			label="Тариф"
			value={billing.isPro ? 'Pro' : 'Бесплатно'}
		/>
		<SettingsRow href="/settings/invite" icon={Gift} label="Позвать друга" value={inviteValue} />
	</SettingsGroup>

	<SettingsGroup step={3}>
		<!--
			Статистика владельца. Строка видна только тем, кого сервер при входе
			назвал администратором; сам экран всё равно спрашивает сервер заново.
		-->
		{#if session.isAdmin}
			<SettingsRow
				href="/admin"
				icon={ChartBar}
				label="Статистика"
				hint="Воронка, возвраты и источники рекламы"
			/>
		{/if}
		<SettingsRow
			href="/settings/devices"
			icon={DeviceMobile}
			label="Устройства"
			value="Приложение на телефон"
		/>
		<SettingsRow href="/settings/capture" icon={Lightning} label="Запись без Telegram" />
		<SettingsRow
			href="/settings/data"
			icon={Database}
			label="Данные и синхронизация"
			value={syncShortLabel(syncQueue.status, session.isAuthenticated)}
		/>
		<SettingsRow href="/settings/about" icon={Info} label="О приложении" />
	</SettingsGroup>

	<!--
		Сами кнопки сброса и удаления живут на экране данных, рядом с выгрузкой:
		перед необратимым шагом логично сначала забрать копию. Здесь — только
		указатель, чтобы их не приходилось искать.
	-->
	<SettingsGroup step={4}>
		<SettingsRow
			href="/settings/data#danger"
			icon={Trash}
			tone="danger"
			label="Сброс и удаление аккаунта"
		/>
	</SettingsGroup>
</div>
