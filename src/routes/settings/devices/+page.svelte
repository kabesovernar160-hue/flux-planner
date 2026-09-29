<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowSquareOut, Check, Copy, DeviceMobile, SignOut, X } from 'phosphor-svelte';
	import { goto } from '$app/navigation';
	import SettingsGroup from '$lib/components/settings/settings-group.svelte';
	import SettingsRow from '$lib/components/settings/settings-row.svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { canUseServer } from '$lib/state/authMode.svelte';
	import { session } from '$lib/state/session.svelte';
	import { telegram } from '$lib/telegram';
	import { authHeaders } from '$lib/telegram/auth';

	/**
	 * Устройства: приложение на телефоне без Telegram и отзыв входов.
	 *
	 * Отсюда же выдаётся код входа — тот, что бот присылает по кнопке
	 * «Приложение на телефон». Из Mini App ссылка открывается во внешнем
	 * браузере, и там приложение сразу ставится на главный экран.
	 */

	interface Device {
		id: string;
		label: string;
		createdAt: string;
		lastSeenAt: string;
		current: boolean;
	}

	let devices = $state<Device[]>([]);
	let loaded = $state(false);
	let listError = $state<string | null>(null);

	async function load() {
		if (!canUseServer()) {
			loaded = true;
			return;
		}

		try {
			const response = await fetch('/api/auth/devices', { headers: authHeaders() });
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				listError = payload?.error?.message ?? 'Не удалось получить список устройств';
			} else {
				devices = payload.devices as Device[];
				listError = null;
			}
		} catch {
			listError = 'Нет связи с сервером';
		}
		loaded = true;
	}

	onMount(() => void load());

	function formatSeen(iso: string): string {
		return new Date(iso).toLocaleString('ru-RU', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// ── Код входа ─────────────────────────────────────────────────────────

	let link = $state<{ code: string; url: string } | null>(null);
	let linkBusy = $state(false);
	let linkError = $state<string | null>(null);
	let copied = $state(false);

	async function issueLink() {
		linkBusy = true;
		linkError = null;
		try {
			const response = await fetch('/api/auth/login-link', {
				method: 'POST',
				headers: authHeaders()
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				linkError = payload?.error?.message ?? 'Не удалось создать код';
				telegram.haptic.notification('error');
			} else {
				link = { code: payload.code, url: payload.url };
				telegram.haptic.notification('success');
			}
		} catch {
			linkError = 'Нет связи с сервером';
		}
		linkBusy = false;
	}

	/**
	 * Внутри Telegram — openLink клиента: он открывает внешний браузер,
	 * а не встроенный, и приложение оттуда ставится на главный экран.
	 */
	function openLink(url: string) {
		const wa = telegram.webApp as unknown as { openLink?: (url: string) => void } | null;
		if (telegram.isEmbedded && wa?.openLink) {
			wa.openLink(url);
			return;
		}
		window.open(url, '_blank', 'noopener');
	}

	async function copyLink(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			/* буфер недоступен — ссылку можно открыть кнопкой рядом */
		}
	}

	// ── Выход ─────────────────────────────────────────────────────────────

	let confirmingAll = $state(false);
	let allTimer: ReturnType<typeof setTimeout> | null = null;
	let signOutError = $state<string | null>(null);

	async function revoke(device: Device) {
		telegram.haptic.impact('medium');

		if (device.current) {
			await signOutHere();
			return;
		}

		try {
			const response = await fetch('/api/auth/devices', {
				method: 'DELETE',
				headers: authHeaders({ 'content-type': 'application/json' }),
				body: JSON.stringify({ id: device.id })
			});
			if (response.ok) devices = devices.filter((item) => item.id !== device.id);
		} catch {
			signOutError = 'Нет связи с сервером';
		}
	}

	async function signOutHere() {
		signOutError = null;
		if (await session.signOut()) {
			void goto('/login', { replaceState: true });
		} else {
			signOutError = 'Не удалось выйти. Проверьте связь и попробуйте ещё раз';
		}
	}

	async function signOutEverywhere() {
		telegram.haptic.impact('medium');
		signOutError = null;

		if (!confirmingAll) {
			confirmingAll = true;
			if (allTimer) clearTimeout(allTimer);
			allTimer = setTimeout(() => (confirmingAll = false), 5000);
			return;
		}

		confirmingAll = false;
		const wasDevice = session.kind === 'device';

		if (!(await session.signOut({ all: true }))) {
			signOutError = 'Не удалось выйти. Проверьте связь и попробуйте ещё раз';
			return;
		}

		telegram.haptic.notification('success');
		if (wasDevice) void goto('/login', { replaceState: true });
		else devices = [];
	}
</script>

<svelte:head>
	<title>Устройства — Flux Planner</title>
</svelte:head>

<PageHeader title="Устройства" subtitle="Приложение на телефоне без Telegram" back="/settings" />

<div class="flex flex-col gap-4">
	{#if session.isAuthenticated}
		<GlassCard class="fx-rise" style="--fx-step: 0">
			<div class="mb-3 flex items-center gap-2.5">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
					<DeviceMobile size={15} weight="regular" class="text-tone" />
				</span>
				<h2 class="flex-1 text-sm font-medium">Приложение на телефон</h2>
			</div>
			<p class="text-sm leading-relaxed text-pretty text-muted-foreground">
				Flux на главном экране — своя иконка, без адресной строки и без Telegram. Данные те же: всё
				синхронизируется.
			</p>

			{#if link}
				<div class="mt-4 rounded-xl border border-lavender/40 bg-lavender/[0.06] p-3">
					<p class="mb-1 text-[11px] text-muted-foreground">
						Код на 10 минут, срабатывает один раз
					</p>
					<p data-selectable class="fx-num mb-3 text-3xl leading-none tracking-[0.08em]">
						{link.code}
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={() => link && openLink(link.url)}
							class="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-lavender text-sm
							       font-medium text-on-accent shadow-accent transition-transform duration-500
							       ease-flux active:scale-[0.98]"
						>
							<ArrowSquareOut size={15} weight="bold" />
							Открыть в браузере
						</button>
						<button
							type="button"
							onclick={() => link && copyLink(link.url)}
							aria-label="Скопировать ссылку"
							class="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong
							       text-muted-foreground transition-[transform,border-color] duration-500
							       ease-flux hover:border-lavender/60 active:scale-90"
						>
							{#if copied}
								<Check size={15} weight="bold" />
							{:else}
								<Copy size={15} weight="light" />
							{/if}
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					onclick={issueLink}
					disabled={linkBusy}
					class="mt-4 flex h-11 w-full items-center justify-center rounded-full bg-lavender text-sm
					       font-medium text-on-accent shadow-accent transition-transform duration-500 ease-flux
					       active:scale-[0.98] disabled:opacity-60"
				>
					Получить ссылку для входа
				</button>
			{/if}

			{#if linkError}
				<p class="mt-2 text-xs text-destructive" role="alert">{linkError}</p>
			{/if}

			<p class="mt-3 border-t border-line/60 pt-3 text-xs leading-relaxed text-muted-foreground">
				Откройте ссылку на телефоне в Safari или Chrome и нажмите «Войти». То же самое присылает бот
				по кнопке «Приложение на телефон».
			</p>
		</GlassCard>

		<SettingsGroup
			title="Где выполнен вход"
			step={1}
			footer={session.kind === 'telegram'
				? 'Mini App в Telegram входит по подписи клиента и в списке не показывается.'
				: undefined}
		>
			{#if !loaded}
				<SettingsRow label="Загружаем…" />
			{:else if listError}
				<SettingsRow label={listError} />
			{:else if devices.length === 0}
				<SettingsRow label="Пока нигде" hint="Телефоны и браузеры появятся здесь после входа" />
			{:else}
				{#each devices as device (device.id)}
					<SettingsRow
						icon={DeviceMobile}
						label={device.label}
						hint={device.current ? 'Это устройство' : `Был в сети ${formatSeen(device.lastSeenAt)}`}
					>
						{#snippet trailing()}
							<button
								type="button"
								onclick={() => revoke(device)}
								aria-label={device.current
									? 'Выйти на этом устройстве'
									: `Отозвать вход: ${device.label}`}
								class="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground
								       transition-colors duration-300 ease-flux hover:text-destructive"
							>
								<X size={15} weight="light" />
							</button>
						{/snippet}
					</SettingsRow>
				{/each}
			{/if}
		</SettingsGroup>

		<SettingsGroup step={2} danger>
			{#if session.kind === 'device'}
				<SettingsRow
					icon={SignOut}
					tone="danger"
					label="Выйти на этом устройстве"
					hint="Записи с этого телефона сотрутся здесь, но останутся в аккаунте."
					onclick={signOutHere}
				/>
			{/if}
			<SettingsRow
				icon={SignOut}
				tone="danger"
				label={confirmingAll ? 'Нажмите ещё раз, чтобы выйти везде' : 'Выйти везде'}
				hint="Все телефоны и браузеры потеряют доступ. Telegram останется."
				onclick={signOutEverywhere}
				class={confirmingAll ? 'bg-destructive/15' : undefined}
			/>
		</SettingsGroup>

		{#if signOutError}
			<p role="alert" class="-mt-2 px-1 text-xs text-destructive">{signOutError}</p>
		{/if}
	{:else}
		<GlassCard class="fx-rise" style="--fx-step: 0">
			<p class="text-sm leading-relaxed text-pretty text-muted-foreground">
				Список устройств и вход на телефоне доступны после входа.
			</p>
			<a
				href="/login"
				class="mt-4 flex h-11 w-full items-center justify-center rounded-full bg-lavender text-sm
				       font-medium text-on-accent shadow-accent transition-transform duration-500 ease-flux
				       active:scale-[0.98]"
			>
				Войти
			</a>
		</GlassCard>
	{/if}
</div>
