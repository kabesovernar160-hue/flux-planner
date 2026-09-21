<script lang="ts">
	import { Barbell, CheckCircle, ForkKnife, ListChecks, Plus, Wallet } from 'phosphor-svelte';
	import type { Component } from 'svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import { addPlanItem, togglePlanItem } from '$lib/services/planService';
	import { addFood } from '$lib/services/nutritionService';
	import { addTransaction } from '$lib/services/financeService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { authHeaders } from '$lib/telegram/auth';
	import type { PlanKind } from '$lib/types/plan';
	import { addDays, getToday } from '$lib/utils/date';
	import { parseQuickEntry } from '$lib/utils/quickParse';

	/**
	 * План на день.
	 *
	 * Ввод один — строкой. «Ужин в 19:00» разбирается на название и время,
	 * а сложные фразы вроде «потратил 500 на такси» уходят в разбор на сервер
	 * и попадают в нужный раздел. Отдельная форма с полями здесь была бы
	 * медленнее того, ради чего её открывают.
	 */

	const items = $derived(plannerStore.todayPlan);
	const done = $derived(plannerStore.donePlanItems.length);

	/**
	 * Дела завтрашнего дня.
	 *
	 * Показываются числом, а не списком: план на завтра полезно видеть
	 * («что-то запланировано»), но разворачивать его на главной — значит
	 * мешать двум дням в одном экране.
	 */
	const tomorrow = $derived(
		plannerStore.planItems.filter(
			(item) => item.date === addDays(getToday(plannerStore.doc.user.timezone), 1)
		)
	);

	/**
	 * Текущее время для отметки просроченного.
	 *
	 * Обновляется раз в минуту: чаще незачем, а без обновления дело,
	 * назначенное на 19:00, так и осталось бы «в будущем» весь вечер.
	 */
	let now = $state(new Date());

	$effect(() => {
		const timer = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(timer);
	});

	const currentTime = $derived(
		`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
	);

	const isToday = $derived(plannerStore.currentDate === getToday(plannerStore.doc.user.timezone));

	/** Время прошло, а дело не закрыто. Только для сегодняшнего дня. */
	function isOverdue(item: { time?: string; done: boolean }): boolean {
		return isToday && !item.done && Boolean(item.time) && item.time! < currentTime;
	}

	const ICONS: Record<PlanKind, Component> = {
		meal: ForkKnife,
		workout: Barbell,
		money: Wallet,
		task: ListChecks
	};

	let draft = $state('');
	let busy = $state(false);
	let hint = $state<string | null>(null);

	/**
	 * Подсказка в поле ввода.
	 *
	 * Поле принимает и план, и еду, и деньги, но узнать об этом неоткуда:
	 * один неизменный пример учит только себе подобным фразам. Пример
	 * выбирается при открытии экрана — не бегущей строкой, которая
	 * отвлекает ровно в тот момент, когда человек начал печатать.
	 */
	const PLACEHOLDERS = ['Ужин в 19:00', '450 борщ', '1,5к на такси', 'Тренировка завтра утром'];
	const placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];

	async function submit(event: SubmitEvent) {
		event.preventDefault();

		const text = draft.trim();
		if (!text || busy) return;

		busy = true;
		hint = null;

		try {
			const applied = await addSmart(text);
			if (applied) {
				draft = '';
				telegram.haptic.notification('success');
			}
		} finally {
			busy = false;
		}
	}

	/**
	 * Пытается понять сообщение целиком, а если не вышло — записывает
	 * как обычный пункт плана. Пустой результат недопустим: человек
	 * написал и ждёт, что что-то появится.
	 */
	async function addSmart(text: string): Promise<boolean> {
		const intent = await parseOnServer(text);

		if (intent && intent.kind !== 'unknown' && intent.kind !== 'plan') {
			const date =
				intent.dayOffset === 0
					? undefined
					: addDays(getToday(plannerStore.doc.user.timezone), intent.dayOffset);

			if (intent.kind === 'food') {
				const result = addFood({
					name: intent.title,
					grams: intent.grams,
					calories: intent.calories ?? 0,
					protein: 0,
					fat: 0,
					carbs: 0,
					source: 'manual',
					date
				});

				if (result.ok) {
					hint = intent.calories
						? `Записал в еду: ${intent.title}`
						: `Записал в еду: ${intent.title}. Калории поправьте в списке.`;
					return true;
				}
			}

			if (intent.kind === 'expense' || intent.kind === 'income') {
				const result = addTransaction({
					type: intent.kind === 'income' ? 'income' : 'expense',
					amount: intent.amount ?? 0,
					category: intent.kind === 'income' ? 'other_income' : 'other',
					note: intent.title,
					date
				});

				if (result.ok) {
					hint = `Записал в финансы: ${intent.title}`;
					return true;
				}
			}
		}

		// Всё остальное — пункт плана. Локальный разбор работает без сети
		// и тем же модулем, что и бот, поэтому используется как основа.
		const local = parseQuickEntry(text);
		const result = addPlanItem({
			title: intent?.kind === 'plan' ? intent.title : local.title,
			time: intent?.time ?? local.time,
			date:
				(intent?.dayOffset ?? local.dayOffset) !== 0
					? addDays(getToday(plannerStore.doc.user.timezone), intent?.dayOffset ?? local.dayOffset)
					: undefined
		});

		if (!result.ok) {
			hint = Object.values(result.errors)[0] ?? 'Не получилось добавить';
			telegram.haptic.notification('error');
			return false;
		}

		return true;
	}

	/**
	 * Разбор на сервере. Недоступен вне Telegram и без сети — это штатно:
	 * пункт плана всё равно добавится по локальным правилам.
	 */
	async function parseOnServer(text: string) {
		if (!telegram.isEmbedded || !telegram.initData) return null;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

		try {
			const response = await fetch('/api/assistant/parse', {
				method: 'POST',
				headers: authHeaders({ 'content-type': 'application/json' }),
				body: JSON.stringify({ text })
			});

			if (!response.ok) return null;

			const payload = await response.json();
			return payload.intent as {
				kind: 'plan' | 'food' | 'expense' | 'income' | 'unknown';
				title: string;
				time?: string;
				dayOffset: number;
				amount?: number;
				grams?: number;
				calories?: number;
			};
		} catch {
			return null;
		}
	}

	function toggle(id: string) {
		const next = togglePlanItem(id);
		if (next) telegram.haptic.notification('success');
		else telegram.haptic.impact('light');
	}
</script>

<GlassCard>
	<div class="mb-3 flex items-center gap-2">
		<ListChecks size={16} weight="light" class="text-lavender" />
		<h2 class="flex-1 text-sm font-medium">План на день</h2>
		{#if items.length > 0}
			<span class="tabular text-sm font-semibold">
				{done}<span class="font-normal text-muted-foreground">&nbsp;из {items.length}</span>
			</span>
		{/if}
	</div>

	{#if items.length === 0}
		<p class="mb-3 text-sm leading-relaxed text-muted-foreground">
			Напишите фразой — разберу сам: «ужин в 19:00» встанет в план, «450 борщ» уйдёт в еду, «1,5к на
			такси» — в траты.
		</p>
	{:else}
		<ul class="mb-3 flex flex-col gap-1.5">
			{#each items as item (item.id)}
				{@const Icon = ICONS[item.kind]}
				<li class="flex items-center gap-3 rounded-xl border border-line/70 bg-white/[0.02] p-3">
					<button
						type="button"
						onclick={() => toggle(item.id)}
						role="checkbox"
						aria-checked={item.done}
						aria-label={item.title}
						class="grid size-5 shrink-0 place-items-center rounded-md border transition-[background-color,border-color]
						       duration-400 ease-flux
						       {item.done ? 'border-lavender bg-lavender' : 'border-line-strong'}"
					>
						{#if item.done}
							<CheckCircle size={13} weight="bold" class="text-void" />
						{/if}
					</button>

					<Icon size={15} weight="light" class="shrink-0 text-muted-foreground" />

					<!--
						Тап по делу открывает правку: время, день, тип и заметка живут
						там же, где и создание. Удаление вынесено внутрь формы, чтобы
						в списке не было кнопки, которую легко задеть случайно.
					-->
					<button
						type="button"
						onclick={() => {
							telegram.haptic.impact('light');
							ui.openPlanSheet({ id: item.id });
						}}
						class="flex min-w-0 flex-1 items-center gap-3 text-left"
					>
						<span class="min-w-0 flex-1">
							<span
								class="block truncate text-sm {item.done
									? 'text-muted-foreground line-through'
									: ''}"
							>
								{item.title}
							</span>
							{#if item.note}
								<span class="block truncate text-xs text-muted-foreground">{item.note}</span>
							{/if}
						</span>

						{#if item.time}
							<span
								class="tabular shrink-0 text-xs {isOverdue(item)
									? 'text-destructive'
									: 'text-muted-foreground'}"
							>
								{item.time}
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<form onsubmit={submit} class="flex gap-2">
		<input
			bind:value={draft}
			type="text"
			autocomplete="off"
			{placeholder}
			disabled={busy}
			class="min-w-0 flex-1 rounded-full border border-line-strong bg-white/[0.03] px-4 py-2.5
			       text-sm transition-colors duration-300 ease-flux outline-none
			       placeholder:text-muted-foreground/50 focus:border-lavender disabled:opacity-60"
		/>
		<button
			type="submit"
			disabled={busy || draft.trim().length === 0}
			aria-label="Добавить в план"
			class="grid size-10 shrink-0 place-items-center rounded-full bg-lavender text-void
			       shadow-accent transition-transform duration-500 ease-flux active:scale-90
			       disabled:pointer-events-none disabled:opacity-40"
		>
			<Plus size={16} weight="bold" />
		</button>
	</form>

	{#if hint}
		<p class="mt-2 text-xs text-muted-foreground">{hint}</p>
	{/if}

	<div class="mt-2 flex items-center gap-3">
		<button
			type="button"
			onclick={() => {
				telegram.haptic.impact('light');
				ui.openPlanSheet();
			}}
			class="text-xs text-muted-foreground transition-colors duration-400 ease-flux
			       hover:text-foreground"
		>
			Со временем и типом
		</button>

		{#if tomorrow.length > 0}
			<span class="ml-auto text-xs text-muted-foreground">
				Завтра: {tomorrow.length}
			</span>
		{/if}
	</div>
</GlassCard>
