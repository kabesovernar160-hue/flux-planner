<script lang="ts">
	import { FileText, ShieldCheck } from 'phosphor-svelte';
	import AppIcon from '$lib/components/brand/app-icon.svelte';
	import SettingsGroup from '$lib/components/settings/settings-group.svelte';
	import SettingsRow from '$lib/components/settings/settings-row.svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { LEGAL_UPDATED } from '$lib/legal';
	import { session } from '$lib/state/session.svelte';
	import { telegram } from '$lib/telegram';
</script>

<svelte:head>
	<title>О приложении — Flux Planner</title>
</svelte:head>

<PageHeader title="О приложении" back="/settings" />

<div class="flex flex-col gap-4">
	<GlassCard bezel class="fx-rise" style="--fx-step: 0">
		<div class="mb-3 flex items-center gap-3">
			<AppIcon size={44} />
			<div class="min-w-0 flex-1">
				<h2 class="text-sm font-medium">Flux Planner</h2>
				<p class="text-xs text-muted-foreground">
					{telegram.isEmbedded ? `Клиент Telegram: ${telegram.platform}` : 'Открыто в браузере'}
				</p>
			</div>
		</div>

		<p class="text-sm leading-relaxed text-pretty text-muted-foreground">
			{#if telegram.isEmbedded}
				Приветствие и кнопка запуска живут в чате с ботом — там же можно прислать фото еды.
			{:else if session.isAuthenticated}
				Приложение на этом устройстве связано с вашим аккаунтом Telegram: записи синхронизируются,
				распознавание по фото работает.
			{:else}
				Войдите по коду из бота — тогда заработают распознавание по фото и синхронизация между
				устройствами.
			{/if}
		</p>
	</GlassCard>

	<SettingsGroup title="Документы" step={1} footer="Обновлены {LEGAL_UPDATED}.">
		<SettingsRow href="/privacy" icon={ShieldCheck} label="Конфиденциальность" />
		<SettingsRow href="/terms" icon={FileText} label="Условия использования" />
	</SettingsGroup>
</div>
