<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowRight, SignIn, TelegramLogo } from 'phosphor-svelte';
	import { goto, replaceState } from '$app/navigation';
	import AppIcon from '$lib/components/brand/app-icon.svelte';
	import InstallGuide from '$lib/components/pwa/install-guide.svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { billing } from '$lib/state/billing.svelte';
	import { session, type AuthPayload } from '$lib/state/session.svelte';
	import { BOT_LOGIN_LINK } from '$lib/pwa/links';
	import { pwa } from '$lib/pwa/pwa.svelte';
	import { telegram } from '$lib/telegram';

	/**
	 * Вход без Telegram.
	 *
	 * Сюда ведёт ссылка из бота (/login?token=…), и сюда же разметка
	 * отправляет приложение, открытое вне Telegram без сессии. Код меняется
	 * на сессию только нажатием кнопки, а не при открытии страницы: превью
	 * ссылок и предзагрузка браузера открывают её без человека и сожгли бы
	 * одноразовый код раньше него.
	 *
	 * После входа — «Добавьте на главный экран»: ради этого человек сюда
	 * и пришёл. Если страница уже открыта с главного экрана, сразу домой.
	 */

	type Stage = 'form' | 'busy' | 'done';

	let stage = $state<Stage>('form');
	let token = $state('');
	let code = $state('');
	let error = $state<string | null>(null);
	let firstName = $state<string | null>(null);

	onMount(() => {
		// Внутри Telegram вход уже есть — подписью клиента.
		if (telegram.isEmbedded) {
			void goto('/', { replaceState: true });
			return;
		}

		token = new URL(window.location.href).searchParams.get('token')?.trim() ?? '';
	});

	async function signIn(value: string) {
		if (!value.trim() || stage === 'busy') return;

		stage = 'busy';
		error = null;

		try {
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: value })
			});
			const payload = await response.json().catch(() => null);

			if (!response.ok) {
				error = payload?.error?.message ?? 'Не удалось войти';
				stage = 'form';
				telegram.haptic.notification('error');
				return;
			}

			await session.adoptDevice(payload as AuthPayload);
			void billing.refresh();
			firstName = (payload as AuthPayload).user.firstName ?? null;

			// Код погашен — в адресной строке и истории ему больше не место.
			replaceState('/login', {});
			token = '';

			if (pwa.standalone) {
				void goto('/', { replaceState: true });
				return;
			}

			stage = 'done';
		} catch {
			error = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз';
			stage = 'form';
		}
	}

	function withoutSignIn() {
		session.continueLocally();
		void goto('/', { replaceState: true });
	}
</script>

<svelte:head>
	<title>Вход — Flux Planner</title>
</svelte:head>

<div class="flex flex-1 flex-col gap-4 pt-6">
	<header class="fx-rise flex flex-col items-center gap-3 pb-2 text-center" style="--fx-step: 0">
		<AppIcon size={72} />
		<div>
			<h1 class="text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.025em]">Flux Planner</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				{stage === 'done'
					? `Вы вошли${firstName ? `, ${firstName}` : ''}`
					: 'Ваш дневник — на главном экране телефона'}
			</p>
		</div>
	</header>

	{#if stage === 'done'}
		<InstallGuide step={1} />

		<button
			type="button"
			onclick={() => goto('/', { replaceState: true })}
			class="fx-rise flex h-12 w-full items-center justify-center gap-2 rounded-full border
			       border-line-strong text-sm font-medium transition-[transform,border-color] duration-500
			       ease-flux hover:border-lavender/60 active:scale-[0.98]"
			style="--fx-step: 2"
		>
			Открыть мой день
			<ArrowRight size={16} weight="bold" />
		</button>
	{:else if token}
		<GlassCard class="fx-rise" style="--fx-step: 1">
			<div class="mb-3 flex items-center gap-2.5">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
					<SignIn size={15} weight="regular" class="text-tone" />
				</span>
				<h2 class="flex-1 text-sm font-medium">Вход на этом устройстве</h2>
			</div>
			<p class="mb-4 text-sm leading-relaxed text-pretty text-muted-foreground">
				Ссылка из бота. Дневник, привычки и траты подтянутся из вашего аккаунта Telegram.
			</p>

			<button
				type="button"
				onclick={() => signIn(token)}
				disabled={stage === 'busy'}
				class="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-lavender text-sm
				       font-medium text-on-accent shadow-accent transition-transform duration-500 ease-flux
				       active:scale-[0.98] disabled:opacity-60"
			>
				{stage === 'busy' ? 'Входим…' : 'Войти на этом устройстве'}
			</button>

			{#if error}
				<p class="mt-3 text-xs leading-relaxed text-destructive" role="alert">{error}</p>
			{/if}

			<p class="mt-3 border-t border-line/60 pt-3 text-xs leading-relaxed text-muted-foreground">
				Открылось внутри Telegram? Сначала откройте страницу в Safari или Chrome — меню «⋯» →
				«Открыть в браузере». Приложение ставится на экран оттуда.
			</p>
		</GlassCard>
	{:else}
		<GlassCard class="fx-rise" style="--fx-step: 1">
			<div class="mb-3 flex items-center gap-2.5">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
					<SignIn size={15} weight="regular" class="text-tone" />
				</span>
				<h2 class="flex-1 text-sm font-medium">Войдите через бота</h2>
			</div>

			<ol class="mb-4 flex flex-col gap-2.5 text-sm">
				<li class="flex gap-3">
					<span
						class="tabular grid size-6 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-xs
						       text-muted-foreground">1</span
					>
					<span>Откройте бота Flux Planner в Telegram</span>
				</li>
				<li class="flex gap-3">
					<span
						class="tabular grid size-6 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-xs
						       text-muted-foreground">2</span
					>
					<span>Нажмите «Приложение на телефон» — бот пришлёт ссылку и код</span>
				</li>
				<li class="flex gap-3">
					<span
						class="tabular grid size-6 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-xs
						       text-muted-foreground">3</span
					>
					<span>Нажмите «Войти на этом устройстве» или введите код ниже</span>
				</li>
			</ol>

			<a
				href={BOT_LOGIN_LINK}
				target="_blank"
				rel="noopener"
				class="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-lavender text-sm
				       font-medium text-on-accent shadow-accent transition-transform duration-500 ease-flux
				       active:scale-[0.98]"
			>
				<TelegramLogo size={17} weight="fill" />
				Открыть бота
			</a>

			<form
				class="mt-4 flex gap-2 border-t border-line/60 pt-4"
				onsubmit={(event) => {
					event.preventDefault();
					void signIn(code);
				}}
			>
				<label for="login-code" class="sr-only">Код из бота</label>
				<input
					id="login-code"
					bind:value={code}
					placeholder="Код из бота"
					autocomplete="one-time-code"
					autocapitalize="characters"
					spellcheck="false"
					maxlength="16"
					class="tabular h-11 min-w-0 flex-1 rounded-full border border-line-strong bg-ink/[0.03]
					       px-4 text-sm tracking-[0.12em] uppercase transition-colors duration-300 ease-flux
					       outline-none placeholder:tracking-normal placeholder:text-muted-foreground/60
					       placeholder:normal-case focus:border-lavender"
				/>
				<button
					type="submit"
					disabled={stage === 'busy' || code.trim().length < 10}
					class="h-11 shrink-0 rounded-full border border-line-strong px-5 text-sm font-medium
					       transition-[transform,border-color] duration-500 ease-flux hover:border-lavender/60
					       active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
				>
					{stage === 'busy' ? 'Входим…' : 'Войти'}
				</button>
			</form>

			{#if error}
				<p class="mt-3 text-xs leading-relaxed text-destructive" role="alert">{error}</p>
			{/if}
		</GlassCard>

		<button
			type="button"
			onclick={withoutSignIn}
			class="fx-rise mx-auto rounded-full px-4 py-3 text-sm text-muted-foreground transition-colors
			       duration-400 ease-flux hover:text-foreground"
			style="--fx-step: 2"
		>
			Пользоваться без входа
		</button>
		<p
			class="fx-rise -mt-3 text-center text-xs text-pretty text-muted-foreground"
			style="--fx-step: 2"
		>
			Записи останутся только на этом устройстве, без Telegram и синхронизации.
		</p>
	{/if}
</div>
