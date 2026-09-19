<script lang="ts">
	import {
		ArrowsClockwise,
		Barbell,
		BellSimple,
		CaretRight,
		CloudCheck,
		CloudSlash,
		DownloadSimple,
		Drop,
		ForkKnife,
		PaperPlaneTilt,
		Sparkle,
		Trash,
		Wallet
	} from 'phosphor-svelte';
	import SubscriptionCard from '$lib/components/billing/subscription-card.svelte';
	import OnboardingFlow from '$lib/components/onboarding/onboarding-flow.svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { syncQueue } from '$lib/db/syncQueue.svelte';
	import { session } from '$lib/state/session.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { nowIso, resolveTimeZone } from '$lib/utils/date';
	import { buildExport, exportFileName, toFoodCsv } from '$lib/utils/exportData';
	import { GOAL_LABELS } from '$lib/utils/goals';
	import { formatNumber } from '$lib/utils/format';

	const settings = $derived(plannerStore.doc.settings);
	const nutrition = $derived(plannerStore.todayNutrition);

	/**
	 * Поля-строки, а не числа.
	 *
	 * У input type="number" нельзя нормально очистить поле, чтобы вписать своё
	 * значение: bind отдаёт то число, то undefined. Значение применяется по
	 * уходу с поля — так цель не пересчитывается на каждой набранной цифре.
	 */
	function commit(raw: string, apply: (value: number) => void, min = 0, max = 100_000) {
		const parsed = Number(raw.trim().replace(',', '.'));
		if (!Number.isFinite(parsed) || parsed < min || parsed > max) return;
		apply(Math.round(parsed));
		telegram.haptic.impact('light');
	}

	/**
	 * Цель меняется и в настройках, и в записи текущего дня.
	 *
	 * Настройки — это шаблон для дней без собственной записи. Если у сегодня
	 * запись уже есть, правка одних настроек не отразилась бы на экране,
	 * и человек решил бы, что кнопка не работает.
	 */
	function setCalories(value: number) {
		plannerStore.updateSettings({ calorieGoal: value });
		plannerStore.setCalorieGoal(value);
	}

	function setMacro(key: 'proteinGoal' | 'fatGoal' | 'carbsGoal', value: number) {
		plannerStore.updateSettings({ [key]: value });
		plannerStore.setMacroGoals({ [key]: value });
	}

	function setWater(value: number) {
		plannerStore.updateSettings({ waterGoalMl: value });
		plannerStore.setWaterGoal(value);
	}

	function setBudget(value: number) {
		plannerStore.updateSettings({ dailyBudget: value });
		plannerStore.setDailyBudget(value);
	}

	const SYNC_LABEL: Record<string, string> = {
		idle: 'Всё синхронизировано',
		syncing: 'Синхронизация…',
		offline: 'Нет сети — данные сохранены локально',
		error: 'Не удалось синхронизировать'
	};

	const sessionLabel = $derived.by(() => {
		switch (session.status) {
			case 'authenticated':
				return `Вход выполнен${session.user?.username ? ` · @${session.user.username}` : ''}`;
			case 'authenticating':
				return 'Проверяем подпись Telegram…';
			case 'local':
				return 'Открыто вне Telegram: только локальные данные';
			case 'error':
				return session.error ?? 'Не удалось войти';
			default:
				return 'Ожидание';
		}
	});

	const lastSynced = $derived.by(() => {
		if (!syncQueue.lastSyncedAt) return null;
		return new Date(syncQueue.lastSyncedAt).toLocaleString(settings.locale, {
			hour: '2-digit',
			minute: '2-digit',
			day: 'numeric',
			month: 'short'
		});
	});

	// Сброс подтверждается вторым нажатием: операция необратимая,
	// а системный confirm() в WebView Telegram выглядит чужеродно.
	let confirmingReset = $state(false);
	let resetTimer: ReturnType<typeof setTimeout> | null = null;

	function askReset() {
		telegram.haptic.impact('medium');

		if (confirmingReset) {
			confirmingReset = false;
			void plannerStore.reset().then(() => telegram.haptic.notification('success'));
			return;
		}

		confirmingReset = true;
		if (resetTimer) clearTimeout(resetTimer);
		resetTimer = setTimeout(() => (confirmingReset = false), 5000);
	}

	$effect(() => () => {
		if (resetTimer) clearTimeout(resetTimer);
	});

	const CURRENCIES = ['RUB', 'USD', 'EUR', 'KZT', 'BYN', 'UAH'];

	/** Уведомления: отсутствие настройки означает «включено». */
	const dailySummaryOn = $derived(settings.notifications?.dailySummary !== false);

	function toggleDailySummary() {
		telegram.haptic.selection();
		plannerStore.updateSettings({
			notifications: { ...settings.notifications, dailySummary: !dailySummaryOn }
		});
	}

	/**
	 * Выгрузка идёт через объектный URL и ссылку.
	 *
	 * В WebView Telegram нет привычного «Сохранить как», но файл открывается
	 * системным обработчиком, и данные становятся доступны — это лучше, чем
	 * не иметь выхода вовсе.
	 */
	function download(content: string, filename: string, type: string) {
		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);

		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();

		// Освобождаем сразу: объектный URL живёт до конца сессии страницы.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		telegram.haptic.notification('success');
	}

	function exportJson() {
		const now = nowIso();
		const payload = buildExport(
			{
				schemaVersion: plannerStore.doc.schemaVersion,
				user: plannerStore.doc.user,
				settings: $state.snapshot(plannerStore.doc.settings),
				nutrition: $state.snapshot(plannerStore.doc.nutrition),
				finance: $state.snapshot(plannerStore.doc.finance),
				foodEntries: $state.snapshot(plannerStore.foodEntries),
				habits: $state.snapshot(plannerStore.habits),
				habitCompletions: $state.snapshot(plannerStore.habitCompletions),
				financeEntries: $state.snapshot(plannerStore.financeEntries),
				planItems: $state.snapshot(plannerStore.planItems),
				weightEntries: $state.snapshot(plannerStore.weightEntries)
			},
			now
		);

		download(JSON.stringify(payload, null, 2), exportFileName(now), 'application/json');
	}

	function exportCsv() {
		const now = nowIso();
		download(
			toFoodCsv($state.snapshot(plannerStore.foodEntries)),
			`flux-planner-food-${now.slice(0, 10)}.csv`,
			'text/csv;charset=utf-8'
		);
	}

	/** Анкета открывается повторно: вес меняется, и цели должны меняться с ним. */
	let recalculating = $state(false);

	const profile = $derived(plannerStore.doc.settings.profile);

	const profileSummary = $derived.by(() => {
		if (!profile) return 'Анкета не заполнена — цели стоят по умолчанию';
		const goal = GOAL_LABELS[profile.goal].title.toLowerCase();
		return `${profile.weightKg} кг · ${profile.heightCm} см · ${profile.age} лет · ${goal}`;
	});
</script>

{#snippet numberField(
	id: string,
	label: string,
	value: number,
	unit: string,
	apply: (next: number) => void
)}
	<div class="flex items-center gap-3 py-2.5">
		<label for={id} class="min-w-0 flex-1 text-sm">{label}</label>
		<input
			{id}
			value={formatNumber(value)}
			onblur={(event) => commit(event.currentTarget.value, apply)}
			onkeydown={(event) => {
				if (event.key === 'Enter') event.currentTarget.blur();
			}}
			type="text"
			inputmode="numeric"
			autocomplete="off"
			class="tabular w-24 rounded-xl border border-line-strong bg-white/[0.03] px-3 py-2
			       text-right text-sm transition-colors duration-300 ease-flux outline-none
			       focus:border-lavender"
		/>
		<span class="w-10 shrink-0 text-xs text-muted-foreground">{unit}</span>
	</div>
{/snippet}

{#if recalculating}
	<OnboardingFlow onclose={() => (recalculating = false)} />
{/if}

<PageHeader title="Настройки" subtitle={sessionLabel} />

<div class="flex flex-col gap-4">
	<SubscriptionCard />

	<GlassCard>
		<h2 class="mb-1 flex items-center gap-2 text-sm font-medium">
			<ForkKnife size={15} weight="light" class="text-lavender" />
			Цели по питанию
		</h2>
		<p class="mb-2 text-xs text-muted-foreground">
			Применяются к сегодняшнему дню и ко всем следующим.
		</p>

		<button
			type="button"
			onclick={() => {
				telegram.haptic.impact('light');
				recalculating = true;
			}}
			class="mb-3 flex w-full items-center gap-2.5 rounded-xl border border-line/70
			       bg-white/[0.02] px-3.5 py-3 text-left transition-[transform,border-color]
			       duration-500 ease-flux hover:border-lavender/60 active:scale-[0.99]"
		>
			<Sparkle size={16} weight="light" class="shrink-0 text-lavender" />
			<span class="min-w-0 flex-1">
				<span class="block text-sm">Посчитать под себя</span>
				<span class="block truncate text-xs text-muted-foreground">{profileSummary}</span>
			</span>
			<CaretRight size={14} weight="light" class="shrink-0 text-muted-foreground" />
		</button>

		<div class="divide-y divide-line/70">
			{@render numberField('goal-calories', 'Калории', nutrition.calorieGoal, 'ккал', setCalories)}
			{@render numberField('goal-protein', 'Белки', nutrition.proteinGoal, 'г', (value) =>
				setMacro('proteinGoal', value)
			)}
			{@render numberField('goal-fat', 'Жиры', nutrition.fatGoal, 'г', (value) =>
				setMacro('fatGoal', value)
			)}
			{@render numberField('goal-carbs', 'Углеводы', nutrition.carbsGoal, 'г', (value) =>
				setMacro('carbsGoal', value)
			)}
		</div>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 flex items-center gap-2 text-sm font-medium">
			<Drop size={15} weight="light" class="text-lavender" />
			Вода
		</h2>
		<div class="divide-y divide-line/70">
			{@render numberField('goal-water', 'Норма в день', nutrition.waterGoalMl, 'мл', setWater)}
		</div>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 flex items-center gap-2 text-sm font-medium">
			<Wallet size={15} weight="light" class="text-lavender" />
			Деньги
		</h2>

		<div class="divide-y divide-line/70">
			{@render numberField(
				'goal-budget',
				'Лимит на день',
				plannerStore.todayFinance.budget,
				settings.currency,
				setBudget
			)}
		</div>

		<p class="mt-3 mb-2 text-xs text-muted-foreground">Валюта</p>
		<div class="flex flex-wrap gap-1.5">
			{#each CURRENCIES as currency (currency)}
				<button
					type="button"
					onclick={() => {
						telegram.haptic.selection();
						plannerStore.updateSettings({ currency });
					}}
					aria-pressed={settings.currency === currency}
					class="rounded-full border px-3.5 py-1.5 text-xs transition-[transform,border-color,background-color]
					       duration-500 ease-flux active:scale-95
					       {settings.currency === currency
						? 'border-lavender bg-lavender/12 text-lavender'
						: 'border-line-strong text-muted-foreground'}"
				>
					{currency}
				</button>
			{/each}
		</div>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-3 flex items-center gap-2 text-sm font-medium">
			<Barbell size={15} weight="light" class="text-lavender" />
			Данные
		</h2>

		<div class="flex items-start gap-2.5 rounded-xl border border-line/70 bg-white/[0.02] p-3">
			{#if syncQueue.status === 'offline' || syncQueue.status === 'error'}
				<CloudSlash size={16} weight="light" class="mt-0.5 shrink-0 text-muted-foreground" />
			{:else}
				<CloudCheck size={16} weight="light" class="mt-0.5 shrink-0 text-success" />
			{/if}
			<div class="min-w-0 flex-1">
				<p class="text-sm">{SYNC_LABEL[syncQueue.status] ?? 'Синхронизация'}</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{#if lastSynced}
						Последний обмен: {lastSynced}
					{:else}
						Обмена с сервером ещё не было
					{/if}
				</p>
			</div>
		</div>

		<button
			type="button"
			onclick={() => {
				telegram.haptic.impact('light');
				void syncQueue.syncNow();
			}}
			disabled={!session.isAuthenticated}
			class="mt-2 flex w-full items-center justify-center gap-2 rounded-full border
			       border-line-strong py-2.5 text-xs font-medium transition-[transform,border-color]
			       duration-500 ease-flux hover:border-lavender/60 active:scale-[0.98]
			       disabled:pointer-events-none disabled:opacity-40"
		>
			<ArrowsClockwise size={13} weight="light" />
			Синхронизировать сейчас
		</button>

		{#if !session.isAuthenticated}
			<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
				Синхронизация работает внутри Telegram: сервер принимает данные только по подписи Telegram.
				Здесь всё сохраняется локально.
			</p>
		{/if}

		<div class="mt-4 space-y-1 border-t border-line/70 pt-3 text-xs text-muted-foreground">
			<p>Часовой пояс: {resolveTimeZone(plannerStore.doc.user.timezone)}</p>
			<p>Хранилище: {plannerStore.status === 'memory' ? 'память (временное)' : 'IndexedDB'}</p>
			<p>
				Записей: еда {plannerStore.foodEntries.length} · траты {plannerStore.financeEntries.length}
			</p>
		</div>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 flex items-center gap-2 text-sm font-medium">
			<PaperPlaneTilt size={15} weight="light" class="text-lavender" />
			Telegram
		</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			{#if telegram.isEmbedded}
				Клиент: {telegram.platform}. Приветствие и кнопка запуска живут в чате с ботом — там же
				можно прислать фото еды.
			{:else}
				Приложение открыто в браузере. Полный набор возможностей — внутри Telegram: там работают
				распознавание по фото и синхронизация между устройствами.
			{/if}
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-1 flex items-center gap-2 text-sm font-medium">
			<BellSimple size={15} weight="light" class="text-lavender" />
			Уведомления
		</h2>

		<button
			type="button"
			onclick={toggleDailySummary}
			role="switch"
			aria-checked={dailySummaryOn}
			class="mt-2 flex w-full items-center gap-3 rounded-xl border border-line/70
			       bg-white/[0.02] px-3.5 py-3 text-left transition-[transform,border-color]
			       duration-500 ease-flux active:scale-[0.99]"
		>
			<span class="min-w-0 flex-1">
				<span class="block text-sm">Итоги дня в чате</span>
				<span class="block text-xs text-muted-foreground">
					Вечером бот присылает калории, привычки и траты
				</span>
			</span>
			<span
				class="relative h-6 w-10 shrink-0 rounded-full transition-colors duration-400 ease-flux
				       {dailySummaryOn ? 'bg-lavender' : 'bg-line'}"
			>
				<span
					class="absolute top-1 size-4 rounded-full bg-white transition-[left] duration-400 ease-flux
					       {dailySummaryOn ? 'left-5' : 'left-1'}"
				></span>
			</span>
		</button>

		{#if !telegram.isEmbedded}
			<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
				Сообщения приходят в чат с ботом — настройка подействует, когда приложение открыто из
				Telegram.
			</p>
		{/if}
	</GlassCard>

	<GlassCard>
		<h2 class="mb-1 flex items-center gap-2 text-sm font-medium">
			<DownloadSimple size={15} weight="light" class="text-lavender" />
			Выгрузка данных
		</h2>
		<p class="mb-3 text-xs leading-relaxed text-muted-foreground">
			Записи можно забрать в любой момент: JSON — полный снимок, CSV — таблица о еде для Excel или
			Google Таблиц.
		</p>

		<div class="flex gap-2">
			<button
				type="button"
				onclick={exportJson}
				class="flex-1 rounded-full border border-line-strong py-2.5 text-xs font-medium
				       transition-[transform,border-color] duration-500 ease-flux
				       hover:border-lavender/60 active:scale-[0.98]"
			>
				JSON
			</button>
			<button
				type="button"
				onclick={exportCsv}
				disabled={plannerStore.foodEntries.length === 0}
				class="flex-1 rounded-full border border-line-strong py-2.5 text-xs font-medium
				       transition-[transform,border-color] duration-500 ease-flux
				       hover:border-lavender/60 active:scale-[0.98]
				       disabled:pointer-events-none disabled:opacity-40"
			>
				CSV с едой
			</button>
		</div>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 flex items-center gap-2 text-sm font-medium">
			<Trash size={15} weight="light" class="text-destructive" />
			Сброс
		</h2>
		<p class="mb-3 text-xs leading-relaxed text-muted-foreground">
			Удалит с этого устройства еду, привычки и траты. Данные, уже уехавшие на сервер, вернутся при
			следующей синхронизации.
		</p>
		<button
			type="button"
			onclick={askReset}
			class="w-full rounded-full border py-2.5 text-xs font-medium transition-[transform,color,border-color]
			       duration-500 ease-flux active:scale-[0.98]
			       {confirmingReset
				? 'border-destructive bg-destructive/10 text-destructive'
				: 'border-line-strong text-muted-foreground'}"
		>
			{confirmingReset ? 'Нажмите ещё раз, чтобы стереть' : 'Стереть локальные данные'}
		</button>
	</GlassCard>

	<footer class="pb-1 text-center text-xs text-muted-foreground">
		<a href="/privacy" class="underline-offset-2 hover:text-foreground hover:underline">
			Конфиденциальность
		</a>
		<span class="px-1.5 text-muted-foreground/50">·</span>
		<a href="/terms" class="underline-offset-2 hover:text-foreground hover:underline">
			Условия использования
		</a>
	</footer>
</div>
