<script lang="ts">
	import { Check, Copy, Key, Lightning, Trash } from 'phosphor-svelte';
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
	 *
	 * Компонент отдаёт две карточки: ключ и инструкцию. На отдельном экране
	 * инструкция открыта сразу — прятать её под «подробнее» было нужно, пока
	 * она делила страницу с остальными настройками.
	 */

	type Props = { step?: number };
	let { step = 0 }: Props = $props();

	let tokenState = $state<CaptureTokenState>({ exists: false });
	let token = $state<string | null>(null);
	let busy = $state(false);
	let message = $state<string | null>(null);
	let failed = $state(false);
	/** Что именно скопировано: у ключа и у адреса отдельные отметки. */
	let copied = $state<'token' | 'url' | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;

	const url = $derived(typeof location === 'undefined' ? '' : captureUrl());

	$effect(() => {
		if (!session.isAuthenticated) return;

		void loadCaptureToken().then((result) => {
			if (result.ok) tokenState = result.value;
		});
	});

	$effect(() => () => {
		if (copiedTimer) clearTimeout(copiedTimer);
	});

	/** Дата по-русски: «28 сентября», а не ISO-строка из базы. */
	function formatDay(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
		return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
	}

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

	async function copy(value: string, what: 'token' | 'url') {
		try {
			await navigator.clipboard.writeText(value);
			copied = what;
			telegram.haptic.notification('success');
			if (copiedTimer) clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => (copied = null), 2000);
		} catch {
			// В некоторых клиентах буфер обмена закрыт: значение видно
			// на экране, и его можно выделить руками.
			failed = true;
			message = 'Скопировать не удалось — выделите значение вручную.';
		}
	}
</script>

{#snippet stepNumber(n: number)}
	<span
		class="tabular grid size-5 shrink-0 place-items-center rounded-full bg-tone/12 text-[11px]
		       text-tone"
	>
		{n}
	</span>
{/snippet}

<GlassCard bezel class="fx-rise" style="--fx-step: {step}">
	<div class="mb-2 flex items-center gap-2">
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<Lightning size={15} weight="regular" class="text-tone" />
		</span>
		<h2 class="flex-1 text-sm font-medium">Одна строка — одна запись</h2>
	</div>

	<p class="text-sm leading-relaxed text-pretty text-muted-foreground">
		«Ужин в 19:00», «потратил 500 на такси», «вес 78,4». С кнопки «Действие», двойного касания
		крышки или Siri — не открывая ни чат, ни приложение.
	</p>

	{#if !session.isAuthenticated}
		<p class="mt-3 border-t border-line/60 pt-3 text-xs leading-relaxed text-muted-foreground">
			Ключ выдаётся внутри Telegram: сервер отвечает только по подписи.
		</p>
	{:else}
		{#if token}
			<!--
				Ключ показывается ровно один раз: в базе лежит только его хеш,
				и достать его оттуда нельзя даже нам.
			-->
			<div class="mt-4 rounded-xl border border-lavender/40 bg-lavender/[0.06] p-3">
				<p class="mb-1.5 text-[11px] text-muted-foreground">
					Скопируйте сейчас — показать ещё раз не получится.
				</p>
				<p data-selectable class="tabular mb-2.5 text-xs break-all text-foreground">{token}</p>
				<button
					type="button"
					onclick={() => copy(token ?? '', 'token')}
					class="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-lavender
					       text-sm font-medium text-on-accent shadow-accent transition-transform duration-500
					       ease-flux active:scale-[0.98]"
				>
					{#if copied === 'token'}
						<Check size={15} weight="bold" />
						Скопировано
					{:else}
						<Copy size={15} weight="light" />
						Скопировать ключ
					{/if}
				</button>
			</div>
		{/if}

		<div class="mt-4 flex items-center gap-3 border-t border-line/60 pt-3">
			<Key
				size={16}
				weight={tokenState.exists ? 'fill' : 'light'}
				class="shrink-0 {tokenState.exists ? 'text-tone' : 'text-muted-foreground'}"
			/>
			<div class="min-w-0 flex-1">
				{#if tokenState.exists}
					<p class="text-sm">
						Ключ создан{tokenState.createdAt ? ` ${formatDay(tokenState.createdAt)}` : ''}
					</p>
					<p class="text-xs text-muted-foreground">
						{tokenState.lastUsedAt
							? `Последняя запись через него: ${formatDay(tokenState.lastUsedAt)}`
							: 'Им ещё ни разу не пользовались'}
					</p>
				{:else}
					<p class="text-sm">Ключа пока нет</p>
					<p class="text-xs text-muted-foreground">Создайте его и вставьте в команду</p>
				{/if}
			</div>
		</div>

		<div class="mt-3 flex gap-2">
			<!--
				Пока ключа нет, «Создать» — главное действие экрана и залито.
				Когда ключ есть, новая выдача ломает уже настроенную команду,
				поэтому кнопка становится контурной и не зовёт нажать.
			-->
			<button
				type="button"
				onclick={create}
				disabled={busy}
				class="h-11 flex-1 rounded-full text-sm font-medium transition-[transform,border-color]
				       duration-500 ease-flux active:scale-[0.98]
				       disabled:pointer-events-none disabled:opacity-40
				       {tokenState.exists
					? 'border border-line-strong hover:border-lavender/60'
					: 'bg-lavender text-on-accent shadow-accent hover:bg-lavender-hi'}"
			>
				{tokenState.exists ? 'Создать новый' : 'Создать ключ'}
			</button>

			{#if tokenState.exists}
				<button
					type="button"
					onclick={revoke}
					disabled={busy}
					aria-label="Отозвать ключ"
					class="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong
					       text-muted-foreground transition-[transform,color,border-color] duration-500
					       ease-flux hover:border-destructive/60 hover:text-destructive active:scale-90
					       disabled:pointer-events-none disabled:opacity-40"
				>
					<Trash size={15} weight="light" />
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
	{/if}
</GlassCard>

{#if session.isAuthenticated}
	<GlassCard class="fx-rise" style="--fx-step: {step + 1}">
		<h2 class="mb-3 text-sm font-medium">Как собрать команду на айфоне</h2>

		<!--
			Имена полей выделены: их вписывают руками, и ошибка в одном
			символе молча ломает команду.
		-->
		<ol class="flex flex-col gap-3 text-xs leading-relaxed text-muted-foreground">
			<li class="flex gap-3">
				{@render stepNumber(1)}
				<span class="min-w-0 flex-1">
					«Быстрые команды» → новая команда → действие «Запросить ввод» (или «Диктовать текст»).
				</span>
			</li>
			<li class="flex gap-3">
				{@render stepNumber(2)}
				<span class="min-w-0 flex-1">Действие «Запросить содержимое URL» с адресом ниже.</span>
			</li>
			<li class="flex gap-3">
				{@render stepNumber(3)}
				<span class="min-w-0 flex-1">
					Метод POST. В заголовке слева — имя
					<span class="text-foreground">Authorization</span>, справа — значение
					<span class="text-foreground">Bearer ключ</span> (со словом Bearer и пробелом). Наоборот не
					сработает, а пробел в имени iOS покажет как «сетевое соединение потеряно».
				</span>
			</li>
			<li class="flex gap-3">
				{@render stepNumber(4)}
				<span class="min-w-0 flex-1">
					Тело запроса — <span class="text-foreground">JSON</span>, одно поле
					<span class="text-foreground">text</span>, в него подставьте результат первого действия.
					Тело «Текст» не подойдёт: такой запрос сервер отбивает как межсайтовый.
				</span>
			</li>
			<li class="flex gap-3">
				{@render stepNumber(5)}
				<span class="min-w-0 flex-1"
					>В конце — «Показать результат», чтобы видеть подтверждение.</span
				>
			</li>
		</ol>

		<div class="mt-4 rounded-xl border border-line/70 bg-ink/[0.03] p-3">
			<p class="mb-1 text-[11px] text-muted-foreground">Адрес для шага 2</p>
			<p data-selectable class="mb-2.5 text-xs break-all text-foreground">{url}</p>
			<button
				type="button"
				onclick={() => copy(url, 'url')}
				class="flex h-10 w-full items-center justify-center gap-2 rounded-full border
				       border-line-strong text-xs font-medium transition-[transform,border-color]
				       duration-500 ease-flux hover:border-lavender/60 active:scale-[0.98]"
			>
				{#if copied === 'url'}
					<Check size={13} weight="bold" class="text-tone" />
					Скопировано
				{:else}
					<Copy size={13} weight="light" />
					Скопировать адрес
				{/if}
			</button>
		</div>

		<p class="mt-4 text-xs leading-relaxed text-muted-foreground">
			Дальше команда вешается на кнопку «Действие» (Настройки → Кнопка «Действие» → Быстрая команда)
			или на двойное касание задней панели (Настройки → Универсальный доступ → Касание → Касание
			задней панели).
		</p>

		<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
			Каждая запись приходит и в чат с ботом — вместе с тем, что распознала диктовка. Так видно, что
			телефон услышал «полтора», а не «пол-литра», а из чата одной кнопкой открывается приложение.
		</p>
	</GlassCard>
{/if}
