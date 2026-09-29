<script lang="ts">
	import {
		ArrowsClockwise,
		ArrowUUpLeft,
		CaretDown,
		ChartBar,
		Crown,
		Funnel,
		Gift,
		Lightning,
		Lock,
		Megaphone,
		Users,
		WarningCircle
	} from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { sourceLabel, type AdminStats, type CohortDay, type Rate } from '$lib/stats/metrics';
	import { canUseServer } from '$lib/state/authMode.svelte';
	import { telegram } from '$lib/telegram';
	import { authHeaders } from '$lib/telegram/auth';
	import { formatNumber } from '$lib/utils/format';

	/**
	 * Экран владельца: воронка активации и отдача рекламы.
	 *
	 * В навигации его нет, попасть сюда можно только строкой в настройках,
	 * которая видна администраторам. Но и прямой переход ничего не даст:
	 * цифры отдаёт сервер, и чужому он отвечает «не найдено».
	 */

	type Status = 'idle' | 'loading' | 'ready' | 'denied' | 'error' | 'outside';

	let status = $state<Status>('idle');
	let stats = $state<AdminStats | null>(null);
	let refreshing = $state(false);

	async function load() {
		if (!canUseServer()) {
			status = 'outside';
			return;
		}

		if (stats) refreshing = true;
		else status = 'loading';

		try {
			const response = await fetch('/api/admin/stats', { headers: authHeaders() });

			if (response.status === 404) {
				status = 'denied';
				return;
			}
			if (!response.ok) {
				status = stats ? 'ready' : 'error';
				telegram.haptic.notification('error');
				return;
			}

			stats = (await response.json()) as AdminStats;
			status = 'ready';
		} catch {
			status = stats ? 'ready' : 'error';
		} finally {
			refreshing = false;
		}
	}

	// Как и в карточке приглашения: запрос без готового Telegram ушёл бы
	// без подписи, и экран решил бы, что открыт вне Telegram.
	$effect(() => {
		if (telegram.isReady && status === 'idle') void load();
	});

	function refresh() {
		telegram.haptic.impact('light');
		void load();
	}

	/* ───────────── Форматирование ───────────── */

	function pct(value: Rate | null | undefined): string {
		if (!value || value.rate === null) return '—';
		const exact = value.rate * 100;
		// Десятая доля нужна только малым числам: 0,4 % и 0 % — разные истории.
		return `${exact > 0 && exact < 10 ? exact.toFixed(1).replace('.', ',') : Math.round(exact)}%`;
	}

	function ofText(value: Rate): string {
		return value.of > 0
			? `${formatNumber(value.count)} из ${formatNumber(value.of)}`
			: 'пока некого считать';
	}

	function dayLabel(date: string, withWeekday = false): string {
		return new Date(`${date}T12:00:00.000Z`).toLocaleDateString('ru-RU', {
			day: 'numeric',
			month: 'short',
			...(withWeekday ? { weekday: 'short' } : {}),
			timeZone: 'UTC'
		});
	}

	const updatedAt = $derived(
		stats
			? new Date(stats.generatedAt).toLocaleTimeString('ru-RU', {
					hour: '2-digit',
					minute: '2-digit'
				})
			: null
	);

	const subtitle = $derived(
		stats ? `За ${stats.windowDays} дней · день по UTC · ${updatedAt}` : 'Воронка и источники'
	);

	/* ───────────── Воронка ───────────── */

	const funnelSteps = $derived.by(() => {
		if (!stats) return [];
		const funnel = stats.funnel;
		const start: Rate = {
			count: funnel.started,
			of: funnel.started,
			rate: funnel.started ? 1 : null
		};

		return [
			{ label: 'Нажали /start или открыли', value: start, tone: 'lavender' },
			{ label: 'Открыли приложение', value: funnel.opened, tone: 'lavender' },
			{ label: 'Сделали первую запись', value: funnel.activated, tone: 'amber' },
			{ label: 'Вернулись на следующий день', value: funnel.d1, tone: 'mint' }
		] as const;
	});

	/* ───────────── Когорты ───────────── */

	const peak = $derived(Math.max(1, ...(stats?.cohorts.map((day) => day.users) ?? [1])));

	let selectedDate = $state<string | null>(null);
	const selected = $derived.by<CohortDay | null>(() => {
		if (!stats) return null;
		const cohorts = stats.cohorts;
		return (
			cohorts.find((day) => day.date === selectedDate) ??
			// По умолчанию — последний день, где кто-то пришёл: пустое «сегодня»
			// утром ничего не говорит.
			[...cohorts].reverse().find((day) => day.users > 0) ??
			cohorts[cohorts.length - 1] ??
			null
		);
	});

	function select(date: string) {
		telegram.haptic.selection();
		selectedDate = date;
	}

	let showAllDays = $state(false);
	const tableDays = $derived.by(() => {
		const days = [...(stats?.cohorts ?? [])].reverse().filter((day) => day.users > 0);
		return showAllDays ? days : days.slice(0, 7);
	});
	const hiddenDays = $derived(
		(stats?.cohorts.filter((day) => day.users > 0).length ?? 0) - tableDays.length
	);

	/* ───────────── Источники ───────────── */

	let sourcesPeriod = $state<'window' | 'all'>('window');
	const sources = $derived(
		stats ? (sourcesPeriod === 'window' ? stats.sources : stats.sourcesAllTime) : []
	);
	const sourcesTotal = $derived(sources.reduce((sum, item) => sum + item.started, 0));

	function cell(value: number | null): string {
		return value === null ? '—' : String(value);
	}

	const selectedCells = $derived<[string, string][]>(
		selected
			? [
					['пришли', String(selected.users)],
					['открыли', String(selected.opened)],
					['запись', String(selected.activated)],
					['D1', cell(selected.d1)],
					['D7', cell(selected.d7)]
				]
			: []
	);

	const periodOptions = $derived<['window' | 'all', string][]>([
		['window', `${stats?.windowDays ?? 30} дн`],
		['all', 'всё время']
	]);

	const referralCells = $derived<[string, number][]>(
		stats
			? [
					['пришли', stats.referrals.invited],
					['засчитано', stats.referrals.qualified],
					['ждут', stats.referrals.pending],
					['позвали', stats.referrals.inviters]
				]
			: []
	);
</script>

<PageHeader title="Статистика" {subtitle} back="/settings">
	{#snippet action()}
		{#if status === 'ready'}
			<button
				type="button"
				onclick={refresh}
				disabled={refreshing}
				aria-label="Обновить"
				class="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong
				       text-muted-foreground transition-[transform,border-color] duration-500 ease-flux
				       hover:border-lavender/60 active:scale-90 disabled:opacity-50"
			>
				<ArrowsClockwise size={15} weight="light" class={refreshing ? 'animate-spin' : ''} />
			</button>
		{/if}
	{/snippet}
</PageHeader>

{#snippet notice(title: string, text: string, retry: boolean)}
	<GlassCard class="fx-rise">
		<div class="flex flex-col items-center gap-3 py-6 text-center">
			<span class="grid size-11 place-items-center rounded-2xl bg-tone/12">
				{#if status === 'denied' || status === 'outside'}
					<Lock size={20} weight="light" class="text-tone" />
				{:else}
					<WarningCircle size={20} weight="light" class="text-tone" />
				{/if}
			</span>
			<p class="text-sm font-medium">{title}</p>
			<p class="max-w-64 text-xs leading-relaxed text-pretty text-muted-foreground">{text}</p>
			{#if retry}
				<button
					type="button"
					onclick={refresh}
					class="mt-1 rounded-full border border-line-strong px-4 py-2 text-xs font-medium
					       transition-[transform,border-color] duration-500 ease-flux
					       hover:border-lavender/60 active:scale-[0.98]"
				>
					Повторить
				</button>
			{/if}
		</div>
	</GlassCard>
{/snippet}

{#if status === 'outside'}
	{@render notice(
		'Только внутри Telegram',
		'Статистику сервер отдаёт по подписи Telegram. Откройте приложение из бота.',
		false
	)}
{:else if status === 'denied'}
	{@render notice('Раздел недоступен', 'Этот экран виден только владельцу приложения.', false)}
{:else if status === 'error'}
	{@render notice('Не удалось загрузить', 'Сервер не ответил. Проверьте связь и повторите.', true)}
{:else if status !== 'ready' || !stats}
	<!-- Заглушки повторяют раскладку: экран не прыгает, когда приходят цифры. -->
	<div class="flex flex-col gap-4" aria-busy="true" aria-label="Загрузка статистики">
		<div class="grid grid-cols-2 gap-3">
			{#each [0, 1, 2, 3] as index (index)}
				<div class="h-28 animate-pulse rounded-card bg-ink/[0.04]"></div>
			{/each}
		</div>
		<div class="h-52 animate-pulse rounded-card bg-ink/[0.04]"></div>
		<div class="h-44 animate-pulse rounded-card bg-ink/[0.04]"></div>
	</div>
{:else}
	{@const funnel = stats.funnel}
	<div class="flex flex-col gap-4">
		<!-- ───────────── Плитки ───────────── -->
		<div class="grid grid-cols-2 gap-3">
			{#snippet tile(
				index: number,
				tone: 'amber' | 'mint' | 'sky' | undefined,
				label: string,
				value: string,
				hint: string,
				Icon: typeof Users
			)}
				<GlassCard {tone} padding="sm" class="fx-rise" style="--fx-step: {index}">
					<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<Icon size={13} weight="regular" class="text-tone" />
						{label}
					</div>
					<p class="fx-num mt-2 text-[1.75rem] leading-none">{value}</p>
					<p class="mt-1.5 truncate text-[0.6875rem] text-muted-foreground">{hint}</p>
				</GlassCard>
			{/snippet}

			{@render tile(
				0,
				undefined,
				'Пользователи',
				formatNumber(stats.totals.started),
				`+${formatNumber(stats.totals.newLast7)} за 7 дн · +${formatNumber(stats.totals.newToday)} сегодня`,
				Users
			)}
			{@render tile(
				1,
				'amber',
				'Активация',
				pct(funnel.activated),
				ofText(funnel.activated),
				Lightning
			)}
			{@render tile(2, 'mint', 'Возврат D1', pct(funnel.d1), ofText(funnel.d1), ArrowUUpLeft)}
			{@render tile(
				3,
				'sky',
				'Pro сейчас',
				formatNumber(stats.pro.active),
				stats.pro.paying > 0 ? `платят ${formatNumber(stats.pro.paying)}` : 'платящих пока нет',
				Crown
			)}
		</div>

		<!-- ───────────── Воронка ───────────── -->
		<GlassCard class="fx-rise" style="--fx-step: 4">
			<div class="mb-4 flex items-center gap-2">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
					<Funnel size={15} weight="regular" class="text-tone" />
				</span>
				<h2 class="flex-1 text-sm font-medium">Воронка</h2>
				<span class="text-xs text-muted-foreground">{stats.windowDays} дней</span>
			</div>

			{#if funnel.started === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">
					За {stats.windowDays} дней никто не пришёл.
				</p>
			{:else}
				<ol class="flex flex-col gap-3.5">
					{#each funnelSteps as step, index (step.label)}
						<li class={step.tone === 'lavender' ? '' : `tone-${step.tone}`}>
							<div class="mb-1.5 flex items-baseline gap-2">
								<span class="min-w-0 flex-1 truncate text-sm">{step.label}</span>
								<span class="tabular text-xs text-muted-foreground">
									{formatNumber(step.value.count)}
								</span>
								<span class="fx-num w-12 text-right text-sm">{pct(step.value)}</span>
							</div>
							<div class="h-2 overflow-hidden rounded-full bg-ink/[0.05]">
								<div
									class="h-full rounded-full transition-[width] duration-700 ease-flux"
									style="width: {Math.max(
										step.value.count > 0 ? 2 : 0,
										(step.value.rate ?? 0) * 100
									)}%; background: var(--fx-tone); opacity: {1 - index * 0.12};"
								></div>
							</div>
						</li>
					{/each}
				</ol>

				<p class="mt-4 text-[0.6875rem] leading-relaxed text-muted-foreground">
					Доли — от пришедших. Возврат считается по тем, у кого следующий день уже закончился:
					{ofText(funnel.d1)}. Через неделю вернулись {pct(funnel.d7)}.
				</p>
			{/if}
		</GlassCard>

		<!-- ───────────── Когорты ───────────── -->
		<GlassCard class="fx-rise" style="--fx-step: 5">
			<div class="mb-3 flex items-center gap-2">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
					<ChartBar size={15} weight="regular" class="text-tone" />
				</span>
				<h2 class="flex-1 text-sm font-medium">По дням прихода</h2>
			</div>

			<!--
				Столбик — сколько пришло, заливка — сколько из них сделали запись.
				Разница высот и есть потеря активации, видна без подписей.
			-->
			<div
				class="flex h-24 items-end gap-[3px]"
				role="group"
				aria-label="Новые пользователи по дням"
			>
				{#each stats.cohorts as day (day.date)}
					{@const height = day.users > 0 ? Math.max(8, (day.users / peak) * 100) : 4}
					{@const active = selected?.date === day.date}
					<button
						type="button"
						onclick={() => select(day.date)}
						aria-label="{dayLabel(day.date)}: пришли {day.users}, запись {day.activated}"
						aria-pressed={active}
						class="relative flex h-full flex-1 items-end"
					>
						<span
							class="relative block w-full overflow-hidden rounded-[3px] transition-colors duration-300 ease-flux
							       {active ? 'bg-lavender/45' : 'bg-ink/[0.09]'}"
							style="height: {height}%"
						>
							{#if day.activated > 0}
								<span
									class="absolute inset-x-0 bottom-0 block bg-amber"
									style="height: {(day.activated / day.users) * 100}%; opacity: {active ? 1 : 0.7}"
								></span>
							{/if}
						</span>
					</button>
				{/each}
			</div>
			<div class="mt-1.5 flex justify-between text-[0.625rem] text-muted-foreground">
				<span>{dayLabel(stats.cohorts[0].date)}</span>
				<span>сегодня</span>
			</div>

			{#if selected}
				<div class="mt-3 rounded-xl border border-line/70 bg-ink/[0.02] px-3 py-2.5">
					<p class="mb-1.5 text-xs text-muted-foreground">{dayLabel(selected.date, true)}</p>
					<div class="grid grid-cols-5 gap-1 text-center">
						{#each selectedCells as [label, value] (label)}
							<div>
								<p class="fx-num text-base leading-tight">{value}</p>
								<p class="text-[0.625rem] text-muted-foreground">{label}</p>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if tableDays.length > 0}
				<!-- Фиксированная раскладка: иначе дата забирает ширину и D1/D7 слипаются. -->
				<table class="tabular mt-3 w-full table-fixed text-xs">
					<colgroup>
						<col class="w-[25%]" />
						<col span="5" />
					</colgroup>
					<thead class="text-[0.625rem] text-muted-foreground">
						<tr>
							<th class="py-1.5 text-left font-normal">День</th>
							<th class="py-1.5 text-right font-normal">Пришли</th>
							<th class="py-1.5 text-right font-normal">Открыли</th>
							<th class="py-1.5 text-right font-normal">Запись</th>
							<th class="py-1.5 text-right font-normal">D1</th>
							<th class="py-1.5 text-right font-normal">D7</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-line/50">
						{#each tableDays as day (day.date)}
							<tr>
								<td class="py-1.5 text-muted-foreground">{dayLabel(day.date)}</td>
								<td class="py-1.5 text-right">{day.users}</td>
								<td class="py-1.5 text-right">{day.opened}</td>
								<td class="py-1.5 text-right text-amber">{day.activated}</td>
								<td class="py-1.5 text-right text-mint">{cell(day.d1)}</td>
								<td class="py-1.5 text-right text-sky">{cell(day.d7)}</td>
							</tr>
						{/each}
					</tbody>
				</table>

				{#if hiddenDays > 0 || showAllDays}
					<button
						type="button"
						onclick={() => {
							telegram.haptic.selection();
							showAllDays = !showAllDays;
						}}
						class="mt-2 flex w-full items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground"
					>
						{showAllDays ? 'Свернуть' : `Ещё ${hiddenDays}`}
						<CaretDown
							size={11}
							weight="light"
							class="transition-transform duration-500 ease-flux {showAllDays ? 'rotate-180' : ''}"
						/>
					</button>
				{/if}
			{:else}
				<p class="mt-3 text-center text-xs text-muted-foreground">Новых людей за окно не было.</p>
			{/if}
		</GlassCard>

		<!-- ───────────── Источники ───────────── -->
		<GlassCard class="fx-rise" style="--fx-step: 6">
			<div class="mb-3 flex items-center gap-2">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
					<Megaphone size={15} weight="regular" class="text-tone" />
				</span>
				<h2 class="flex-1 text-sm font-medium">Источники</h2>

				<div class="flex rounded-full border border-line-strong p-0.5 text-[0.6875rem]">
					{#each periodOptions as [value, label] (value)}
						<button
							type="button"
							onclick={() => {
								telegram.haptic.selection();
								sourcesPeriod = value;
							}}
							aria-pressed={sourcesPeriod === value}
							class="rounded-full px-2.5 py-1 transition-colors duration-300 ease-flux
							       {sourcesPeriod === value ? 'bg-lavender/15 text-lavender' : 'text-muted-foreground'}"
						>
							{label}
						</button>
					{/each}
				</div>
			</div>

			{#if sources.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">Пока пусто.</p>
			{:else}
				<ul class="divide-y divide-line/50">
					{#each sources as item (item.source)}
						<li class="py-2.5">
							<div class="flex items-baseline gap-2">
								<span class="min-w-0 flex-1 truncate text-sm">{sourceLabel(item.source)}</span>
								<span class="fx-num text-sm">{formatNumber(item.started)}</span>
							</div>
							<div class="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.05]">
								<div
									class="h-full rounded-full bg-lavender/70"
									style="width: {sourcesTotal ? (item.started / sourcesTotal) * 100 : 0}%"
								></div>
							</div>
							<p class="tabular mt-1.5 flex gap-3 text-[0.6875rem] text-muted-foreground">
								<span>открыли {pct(item.opened)}</span>
								<span class="text-amber/90">запись {pct(item.activated)}</span>
								<span class="text-mint/90">D1 {pct(item.d1)}</span>
								<span class="text-sky/90">D7 {pct(item.d7)}</span>
							</p>
						</li>
					{/each}
				</ul>
				<p class="mt-2 text-[0.6875rem] leading-relaxed text-muted-foreground">
					Метка — параметр ссылки: t.me/бот?start=tiktok или t.me/бот/app?startapp=tiktok. «До
					учёта» — пришли раньше, чем источник начали записывать.
				</p>
			{/if}
		</GlassCard>

		<!-- ───────────── Приглашения ───────────── -->
		<GlassCard tone="mint" class="fx-rise" style="--fx-step: 7">
			<div class="mb-3 flex items-center gap-2">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
					<Gift size={15} weight="regular" class="text-tone" />
				</span>
				<h2 class="flex-1 text-sm font-medium">Приглашения</h2>
			</div>

			<div class="grid grid-cols-4 gap-2 text-center">
				{#each referralCells as [label, value] (label)}
					<div>
						<p class="fx-num text-xl leading-tight">{formatNumber(value)}</p>
						<p class="text-[0.625rem] text-muted-foreground">{label}</p>
					</div>
				{/each}
			</div>
			<p class="mt-3 text-[0.6875rem] text-muted-foreground">
				Роздано {formatNumber(stats.referrals.daysGranted)} дн. Pro обеим сторонам.
			</p>
		</GlassCard>

		<p class="px-1 pb-2 text-center text-[0.6875rem] text-muted-foreground/70">
			Без тестовых аккаунтов: {formatNumber(stats.excludedTestAccounts)} не в счёте.
		</p>
	</div>
{/if}
