<script lang="ts">
	import { ArrowSquareOut, Copy, Lightning, Trash } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import {
		captureUrl,
		issueCaptureToken,
		loadCaptureToken,
		revokeCaptureToken,
		type CaptureTokenState
	} from '$lib/services/captureService';
	import { session } from '$lib/state/session.svelte';
	import { telegram } from '$lib/telegram';

	/**
	 * Быстрая запись с телефона.
	 *
	 * Смысл экрана — не «настройка», а один ключ, который человек один раз
	 * вставляет в «Быструю команду» и дальше записывает дела, не открывая
	 * ни Telegram, ни приложение. Поэтому здесь же и инструкция: ключ без
	 * объяснения, что с ним делать, — это просто строка символов.
	 */

	let tokenState = $state<CaptureTokenState>({ exists: false });
	let token = $state<string | null>(null);
	let busy = $state(false);
	let message = $state<string | null>(null);
	let failed = $state(false);
	let copied = $state(false);

	const url = $derived(typeof location === 'undefined' ? '' : captureUrl());

	$effect(() => {
		if (!session.isAuthenticated) return;

		void loadCaptureToken().then((result) => {
			if (result.ok) tokenState = result.value;
		});
	});

	async function create() {
		busy = true;
		message = null;
		telegram.haptic.impact('light');

		const result = await issueCaptureToken();
		busy = false;

		if (!result.ok) {
			failed = true;
			message = Object.values(result.errors)[0] ?? 'Не удалось создать ключ';
			telegram.haptic.notification('error');
			return;
		}

		failed = false;
		token = result.value.token;
		tokenState = { exists: true, createdAt: result.value.createdAt, lastUsedAt: null };
		telegram.haptic.notification('success');
	}

	async function revoke() {
		busy = true;
		message = null;
		telegram.haptic.impact('medium');

		const result = await revokeCaptureToken();
		busy = false;

		if (!result.ok) {
			failed = true;
			message = Object.values(result.errors)[0] ?? 'Не удалось отозвать ключ';
			return;
		}

		failed = false;
		token = null;
		tokenState = { exists: false };
		message = 'Ключ отозван. Команда на телефоне перестанет работать.';
	}

	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			telegram.haptic.notification('success');
			setTimeout(() => (copied = false), 2000);
		} catch {
			// В некоторых клиентах буфер обмена закрыт: значение видно
			// на экране, и его можно выделить руками.
			failed = true;
			message = 'Скопировать не удалось — выделите значение вручную.';
		}
	}
</script>

<GlassCard>
	<h2 class="mb-1 flex items-center gap-2 text-sm font-medium">
		<Lightning size={15} weight="light" class="text-lavender" />
		Запись без Telegram
	</h2>

	<p class="mb-3 text-xs leading-relaxed text-muted-foreground">
		Одна строка — одна запись: «ужин в 19:00», «потратил 500 на такси», «вес 78,4». Работает с
		кнопки «Действие», двойного касания крышки или Siri — не открывая ни чат, ни приложение.
	</p>

	{#if !session.isAuthenticated}
		<p class="text-xs leading-relaxed text-muted-foreground">
			Ключ выдаётся внутри Telegram: сервер отвечает только по подписи.
		</p>
	{:else}
		{#if token}
			<!--
				Ключ показывается ровно один раз: в базе лежит только его хеш,
				и достать его оттуда нельзя даже нам.
			-->
			<div class="mb-3 rounded-xl border border-lavender/40 bg-lavender/[0.06] p-3">
				<p class="mb-1.5 text-[11px] text-muted-foreground">
					Скопируйте сейчас — показать ещё раз не получится.
				</p>
				<p class="tabular mb-2 text-xs break-all text-foreground">{token}</p>
				<button
					type="button"
					onclick={() => copy(token ?? '')}
					class="flex w-full items-center justify-center gap-2 rounded-full bg-lavender py-2.5
					       text-xs font-medium text-void transition-transform duration-500 ease-flux
					       active:scale-[0.98]"
				>
					<Copy size={13} weight="light" />
					{copied ? 'Скопировано' : 'Скопировать ключ'}
				</button>
			</div>
		{/if}

		<div class="mb-3 space-y-1 text-xs text-muted-foreground">
			{#if tokenState.exists}
				<p>Ключ создан{tokenState.createdAt ? ` ${tokenState.createdAt.slice(0, 10)}` : ''}.</p>
				<p>
					{tokenState.lastUsedAt
						? `Последняя запись через него: ${tokenState.lastUsedAt.slice(0, 10)}.`
						: 'Им ещё ни разу не пользовались.'}
				</p>
			{:else}
				<p>Ключа пока нет.</p>
			{/if}
		</div>

		<div class="flex gap-2">
			<button
				type="button"
				onclick={create}
				disabled={busy}
				class="flex-1 rounded-full border border-line-strong py-2.5 text-xs font-medium
				       transition-[transform,border-color] duration-500 ease-flux
				       hover:border-lavender/60 active:scale-[0.98]
				       disabled:pointer-events-none disabled:opacity-40"
			>
				{tokenState.exists ? 'Создать новый' : 'Создать ключ'}
			</button>

			{#if tokenState.exists}
				<button
					type="button"
					onclick={revoke}
					disabled={busy}
					aria-label="Отозвать ключ"
					class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
					       text-muted-foreground transition-transform duration-500 ease-flux
					       active:scale-90 disabled:pointer-events-none disabled:opacity-40"
				>
					<Trash size={13} weight="light" />
				</button>
			{/if}
		</div>

		{#if message}
			<p
				class="mt-2 text-xs leading-relaxed {failed ? 'text-destructive' : 'text-muted-foreground'}"
			>
				{message}
			</p>
		{/if}

		<details class="mt-3 border-t border-line/70 pt-3">
			<summary class="cursor-pointer text-xs text-muted-foreground">
				Как собрать команду на айфоне
			</summary>

			<ol class="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
				<li>
					1. «Быстрые команды» → новая команда → действие «Запросить ввод» (или «Диктовать текст»).
				</li>
				<li>
					2. Действие «Запросить содержимое URL». Адрес:
					<span class="break-all text-foreground">{url}</span>
				</li>
				<li>
					3. Метод POST. В заголовке слева — имя
					<span class="text-foreground">Authorization</span>, справа — значение
					<span class="text-foreground">Bearer ключ</span> (со словом Bearer и пробелом). Наоборот не
					сработает, а пробел в имени iOS покажет как «сетевое соединение потеряно».
				</li>
				<li>
					4. Тело запроса — <span class="text-foreground">JSON</span>, одно поле
					<span class="text-foreground">text</span>, в него подставьте результат первого действия.
					Тело «Текст» не подойдёт: такой запрос сервер отбивает как межсайтовый.
				</li>
				<li>5. В конце — «Показать результат», чтобы видеть подтверждение.</li>
			</ol>

			<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
				Дальше команда вешается на кнопку «Действие» (Настройки → Кнопка «Действие» → Быстрая
				команда) или на двойное касание задней панели (Настройки → Универсальный доступ → Касание →
				Касание задней панели).
			</p>

			<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
				Каждая запись приходит и в чат с ботом — вместе с тем, что распознала диктовка. Так видно,
				что телефон услышал «полтора», а не «пол-литра», а из чата одной кнопкой открывается
				приложение.
			</p>

			<button
				type="button"
				onclick={() => copy(url)}
				class="mt-2 flex w-full items-center justify-center gap-2 rounded-full border
				       border-line-strong py-2.5 text-xs font-medium transition-[transform,border-color]
				       duration-500 ease-flux hover:border-lavender/60 active:scale-[0.98]"
			>
				<ArrowSquareOut size={13} weight="light" />
				Скопировать адрес
			</button>
		</details>
	{/if}
</GlassCard>
