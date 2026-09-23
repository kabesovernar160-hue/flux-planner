<script lang="ts">
	import {
		ArrowsClockwise,
		BellSimple,
		CaretRight,
		CloudCheck,
		CloudSlash,
		Database,
		DownloadSimple,
		UploadSimple,
		Drop,
		ForkKnife,
		Info,
		Scales,
		Sparkle,
		Trash,
		Wallet
	} from 'phosphor-svelte';
	import SubscriptionCard from '$lib/components/billing/subscription-card.svelte';
	import CaptureCard from '$lib/components/capture/capture-card.svelte';
	import OnboardingFlow from '$lib/components/onboarding/onboarding-flow.svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { syncQueue } from '$lib/db/syncQueue.svelte';
	import { session } from '$lib/state/session.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { deleteAccount } from '$lib/services/accountService';
	import { importFromFile } from '$lib/services/importService';
	import { setWeightGoal } from '$lib/services/weightService';
	import { ui } from '$lib/state/ui.svelte';
	import { telegram } from '$lib/telegram';
	import { nowIso, resolveTimeZone } from '$lib/utils/date';
	import { buildExport, exportFileName, toFoodCsv, toWeightCsv } from '$lib/utils/exportData';
	import { GOAL_LABELS } from '$lib/utils/goals';
	import { formatNumber, formatWeight } from '$lib/utils/format';

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

	/**
	 * Цель по весу вводится с десятыми, а не целым числом.
	 *
	 * Общий commit() округляет до целого — для калорий это правильно,
	 * для веса нет: между 75 и 75,5 килограммами разница, ради которой
	 * цель и ставят. Пустое поле снимает цель совсем.
	 */
	function commitWeightGoal(raw: string) {
		const text = raw.trim().replace(',', '.');

		if (text === '') {
			setWeightGoal(null);
			return;
		}

		const parsed = Number(text);
		if (!Number.isFinite(parsed)) return;

		if (setWeightGoal(parsed).ok) telegram.haptic.impact('light');
		else telegram.haptic.notification('error');
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

	/**
	 * Удаление учётной записи — в два нажатия и с отдельным текстом.
	 *
	 * Оно необратимо и, в отличие от сброса, стирает данные и на сервере.
	 * Одна кнопка рядом с «Стереть локальные данные» неизбежно была бы нажата
	 * не та.
	 */
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	let deleted = $state(false);
	let deleteTimer: ReturnType<typeof setTimeout> | null = null;

	async function askDelete() {
		telegram.haptic.impact('medium');
		deleteError = null;

		if (!confirmingDelete) {
			confirmingDelete = true;
			if (deleteTimer) clearTimeout(deleteTimer);
			deleteTimer = setTimeout(() => (confirmingDelete = false), 5000);
			return;
		}

		confirmingDelete = false;
		deleting = true;

		const result = await deleteAccount();
		deleting = false;

		if (!result.ok) {
			deleteError = Object.values(result.errors)[0] ?? 'Не удалось удалить данные';
			telegram.haptic.notification('error');
			return;
		}

		deleted = true;
		telegram.haptic.notification('success');
	}

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

	/**
	 * Восстановление из файла.
	 *
	 * Записи сливаются, а не заменяются: файл вчерашний, а сегодняшние правки
	 * терять нельзя. Итог показывается числами — «добавлено 128» проверяемо,
	 * а «готово» нет.
	 */
	let importing = $state(false);
	let importMessage = $state<string | null>(null);
	let importFailed = $state(false);

	async function handleImport(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		// Значение сбрасывается сразу: иначе повторный выбор того же файла
		// не вызовет change и человек решит, что кнопка сломалась.
		event.currentTarget.value = '';
		if (!file) return;

		importing = true;
		importMessage = null;

		const result = await importFromFile(file);
		importing = false;
		importFailed = !result.ok;

		if (!result.ok) {
			importMessage = Object.values(result.errors)[0] ?? 'Не удалось прочитать файл';
			telegram.haptic.notification('error');
			return;
		}

		const parts = [`добавлено ${result.value.added}`];
		if (result.value.updated > 0) parts.push(`обновлено ${result.value.updated}`);
		if (result.value.skipped > 0) parts.push(`пропущено ${result.value.skipped}`);
		if (result.value.settingsApplied) parts.push('цели перенесены');

		importMessage = `Готово: ${parts.join(', ')}.`;
		telegram.haptic.notification('success');
	}

	function exportJson() {
		const now = nowIso();
		const payload = buildExport(
			{
				schemaVersion: plannerStore.doc.schemaVersion,
				user: plannerStore.doc.user,
				settings: $state.snapshot(plannerStore.doc.settings),
				settingsUpdatedAt: plannerStore.doc.settingsUpdatedAt,
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

	function exportWeightCsv() {
		const now = nowIso();
		download(
			toWeightCsv($state.snapshot(plannerStore.weightEntries)),
			`flux-planner-weight-${now.slice(0, 10)}.csv`,
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
			       focus:border-tone"
		/>
		<span class="w-10 shrink-0 text-xs text-muted-foreground">{unit}</span>
	</div>
{/snippet}

{#snippet infoRow(label: string, value: string)}
	<div class="flex items-center gap-3 py-2.5">
		<span class="min-w-0 flex-1 text-sm text-muted-foreground">{label}</span>
		<span class="tabular shrink-0 text-sm">{value}</span>
	</div>
{/snippet}

{#if recalculating}
	<OnboardingFlow onclose={() => (recalculating = false)} />
{/if}

<PageHeader title="Настройки" subtitle={sessionLabel} />

<div class="flex flex-col gap-4">
	<!-- Профиль и цели — самый используемый раздел, поэтому первый и заметнее прочих. -->
	<GlassCard tone="amber">
		<div class="mb-1 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<ForkKnife size={15} weight="regular" class="text-tone" />
			</span>
			<h2 class="flex-1 text-sm font-medium">Профиль и цели</h2>
		</div>
		<p class="mb-3 text-xs text-muted-foreground">Действуют на сегодня и на все следующие дни.</p>

		<button
			type="button"
			onclick={() => {
				telegram.haptic.impact('light');
				recalculating = true;
			}}
			class="mb-3 flex w-full items-center gap-2.5 rounded-xl border border-line/70
			       bg-white/[0.02] px-3.5 py-3 text-left transition-[transform,border-color]
			       duration-500 ease-flux hover:border-tone/60 active:scale-[0.99]"
		>
			<Sparkle size={16} weight="light" class="shrink-0 text-tone" />
			<span class="min-w-0 flex-1">
				<span class="block text-sm">Посчитать под себя</span>
				<span class="block text-xs text-pretty text-muted-foreground">{profileSummary}</span>
			</span>
			<CaretRight size={14} weight="light" class="shrink-0 text-muted-foreground" />
		</button>

		<p class="mb-1 text-xs text-muted-foreground">Калории и БЖУ</p>
		<div class="divide-y divide-line/60">
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

		<div class="flex items-center gap-3 border-t border-line/60 py-2.5">
			<Drop size={14} weight="light" class="shrink-0 text-tone" />
			<label for="goal-water" class="min-w-0 flex-1 text-sm">Вода, норма</label>
			<input
				id="goal-water"
				value={formatNumber(nutrition.waterGoalMl)}
				onblur={(event) => commit(event.currentTarget.value, setWater)}
				onkeydown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
				}}
				type="text"
				inputmode="numeric"
				autocomplete="off"
				class="tabular w-24 rounded-xl border border-line-strong bg-white/[0.03] px-3 py-2
				       text-right text-sm transition-colors duration-300 ease-flux outline-none
				       focus:border-tone"
			/>
			<span class="w-10 shrink-0 text-xs text-muted-foreground">мл</span>
		</div>

		<!--
			Цель по весу необязательна: дневник полезен и без неё, а навязанная
			цифра превращает его в укор. Пустое поле снимает цель.
		-->
		<div class="flex items-center gap-3 border-t border-line/60 py-2.5">
			<Scales size={14} weight="light" class="shrink-0 text-tone" />
			<label for="goal-weight" class="min-w-0 flex-1 text-sm">Вес, цель</label>
			<input
				id="goal-weight"
				value={plannerStore.doc.settings.weightGoalKg
					? formatWeight(plannerStore.doc.settings.weightGoalKg)
					: ''}
				onblur={(event) => commitWeightGoal(event.currentTarget.value)}
				onkeydown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
				}}
				type="text"
				inputmode="decimal"
				autocomplete="off"
				placeholder="нет"
				class="tabular w-24 rounded-xl border border-line-strong bg-white/[0.03] px-3 py-2
				       text-right text-sm transition-colors duration-300 ease-flux outline-none
				       placeholder:text-muted-foreground/50 focus:border-tone"
			/>
			<span class="w-10 shrink-0 text-xs text-muted-foreground">кг</span>
		</div>

		<div class="mt-1 flex items-center justify-between gap-3 border-t border-line/60 pt-3">
			<p class="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
				{#if plannerStore.latestWeight}
					Последнее: {formatWeight(plannerStore.latestWeight.weightKg)} кг, {plannerStore
						.latestWeight.date}
				{:else}
					Взвешиваний пока нет
				{/if}
			</p>
			<button
				type="button"
				onclick={() => ui.openWeightSheet()}
				class="shrink-0 rounded-full border border-line-strong px-3.5 py-2 text-xs font-medium
				       transition-[transform,border-color] duration-500 ease-flux
				       hover:border-tone/60 active:scale-[0.98]"
			>
				Записать вес
			</button>
		</div>
	</GlassCard>

	<GlassCard tone="mint">
		<div class="mb-1 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<BellSimple size={15} weight="regular" class="text-tone" />
			</span>
			<h2 class="flex-1 text-sm font-medium">Уведомления</h2>
		</div>

		<button
			type="button"
			onclick={toggleDailySummary}
			role="switch"
			aria-checked={dailySummaryOn}
			class="flex w-full items-center gap-3 py-2 text-left"
		>
			<span class="min-w-0 flex-1">
				<span class="block text-sm">Итоги дня в чате</span>
				<span class="block text-xs text-muted-foreground">
					Вечером бот присылает калории, привычки и траты
				</span>
			</span>
			<span
				class="relative h-6 w-10 shrink-0 rounded-full transition-colors duration-400 ease-flux
				       {dailySummaryOn ? 'bg-tone' : 'bg-line'}"
			>
				<span
					class="absolute top-1 size-4 rounded-full bg-white transition-[left] duration-400 ease-flux
					       {dailySummaryOn ? 'left-5' : 'left-1'}"
				></span>
			</span>
		</button>

		{#if !telegram.isEmbedded}
			<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
				Сообщения приходят в чат с ботом — настройка подействует, когда приложение открыто из
				Telegram.
			</p>
		{/if}
	</GlassCard>

	<SubscriptionCard />

	<GlassCard tone="sky">
		<div class="mb-1 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<Wallet size={15} weight="regular" class="text-tone" />
			</span>
			<h2 class="flex-1 text-sm font-medium">Деньги</h2>
		</div>

		<div class="divide-y divide-line/60">
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
						? 'border-tone bg-tone/12 text-tone'
						: 'border-line-strong text-muted-foreground'}"
				>
					{currency}
				</button>
			{/each}
		</div>
	</GlassCard>

	<GlassCard>
		<div class="mb-1 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<Database size={15} weight="regular" class="text-tone" />
			</span>
			<h2 class="flex-1 text-sm font-medium">Данные и аккаунт</h2>
		</div>

		<div class="flex items-center gap-2.5 py-2.5">
			{#if syncQueue.status === 'offline' || syncQueue.status === 'error'}
				<CloudSlash size={16} weight="light" class="shrink-0 text-muted-foreground" />
			{:else}
				<CloudCheck size={16} weight="light" class="shrink-0 text-success" />
			{/if}
			<span class="min-w-0 flex-1">
				<span class="block text-sm">{SYNC_LABEL[syncQueue.status] ?? 'Синхронизация'}</span>
				<span class="block text-xs text-muted-foreground">
					{lastSynced ? `Последний обмен: ${lastSynced}` : 'Обмена с сервером ещё не было'}
				</span>
			</span>
			<button
				type="button"
				onclick={() => {
					telegram.haptic.impact('light');
					void syncQueue.syncNow();
				}}
				disabled={!session.isAuthenticated}
				aria-label="Синхронизировать сейчас"
				class="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong
				       text-muted-foreground transition-[transform,border-color] duration-500 ease-flux
				       hover:border-tone/60 active:scale-90 disabled:pointer-events-none disabled:opacity-40"
			>
				<ArrowsClockwise size={13} weight="light" />
			</button>
		</div>

		{#if !session.isAuthenticated}
			<p class="mb-1 text-xs leading-relaxed text-muted-foreground">
				Синхронизация работает внутри Telegram: сервер принимает данные только по подписи Telegram.
				Здесь всё сохраняется локально.
			</p>
		{/if}

		<div class="divide-y divide-line/60 border-t border-line/60">
			{@render infoRow('Часовой пояс', resolveTimeZone(plannerStore.doc.user.timezone))}
			{@render infoRow(
				'Хранилище',
				plannerStore.status === 'memory' ? 'память (временное)' : 'IndexedDB'
			)}
			{@render infoRow(
				'Записей',
				`еда ${plannerStore.foodEntries.length} · траты ${plannerStore.financeEntries.length}`
			)}
		</div>

		<div class="mt-3 border-t border-line/60 pt-3">
			<p class="mb-2 text-xs leading-relaxed text-muted-foreground">
				Записи можно забрать в любой момент: JSON — полный снимок, CSV — таблица о еде для Excel или
				Google Таблиц. Снимок принимается обратно: записи сливаются по времени изменения, свежее
				побеждает.
			</p>

			<div class="flex gap-2">
				<button
					type="button"
					onclick={exportJson}
					class="flex-1 rounded-full border border-line-strong py-2.5 text-xs font-medium
					       transition-[transform,border-color] duration-500 ease-flux
					       hover:border-tone/60 active:scale-[0.98]"
				>
					JSON
				</button>
				<button
					type="button"
					onclick={exportCsv}
					disabled={plannerStore.foodEntries.length === 0}
					class="flex-1 rounded-full border border-line-strong py-2.5 text-xs font-medium
					       transition-[transform,border-color] duration-500 ease-flux
					       hover:border-tone/60 active:scale-[0.98]
					       disabled:pointer-events-none disabled:opacity-40"
				>
					CSV с едой
				</button>
				<button
					type="button"
					onclick={exportWeightCsv}
					disabled={plannerStore.weightEntries.length === 0}
					class="flex-1 rounded-full border border-line-strong py-2.5 text-xs font-medium
					       transition-[transform,border-color] duration-500 ease-flux
					       hover:border-tone/60 active:scale-[0.98]
					       disabled:pointer-events-none disabled:opacity-40"
				>
					CSV с весом
				</button>
			</div>

			<label
				class="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full
				       border border-line-strong py-2.5 text-xs font-medium
				       transition-[transform,border-color] duration-500 ease-flux
				       hover:border-tone/60 active:scale-[0.98]"
			>
				<UploadSimple size={13} weight="light" class="text-tone" />
				{importing ? 'Читаем файл…' : 'Восстановить из JSON'}
				<input
					type="file"
					accept="application/json,.json"
					onchange={handleImport}
					disabled={importing}
					class="sr-only"
				/>
			</label>

			{#if importMessage}
				<p
					class="mt-2 text-xs leading-relaxed {importFailed
						? 'text-destructive'
						: 'text-muted-foreground'}"
				>
					{importMessage}
				</p>
			{/if}
		</div>
	</GlassCard>

	<CaptureCard />

	<GlassCard>
		<div class="mb-1 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
				<Info size={15} weight="regular" class="text-tone" />
			</span>
			<h2 class="flex-1 text-sm font-medium">О приложении</h2>
		</div>
		<p class="text-xs leading-relaxed text-muted-foreground">
			{#if telegram.isEmbedded}
				Клиент: {telegram.platform}. Приветствие и кнопка запуска живут в чате с ботом — там же
				можно прислать фото еды.
			{:else}
				Приложение открыто в браузере. Полный набор возможностей — внутри Telegram: там работают
				распознавание по фото и синхронизация между устройствами.
			{/if}
		</p>

		<div
			class="mt-3 flex items-center gap-1.5 border-t border-line/60 pt-3 text-xs text-muted-foreground"
		>
			<a href="/privacy" class="underline-offset-2 hover:text-foreground hover:underline">
				Конфиденциальность
			</a>
			<span class="text-muted-foreground/50">·</span>
			<a href="/terms" class="underline-offset-2 hover:text-foreground hover:underline">
				Условия использования
			</a>
		</div>
	</GlassCard>

	<!-- Необратимые действия — внизу, отдельно, без большого красного блока. -->
	<GlassCard>
		<div class="mb-2 flex items-center gap-2">
			<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-destructive/12">
				<Trash size={15} weight="regular" class="text-destructive" />
			</span>
			<h2 class="flex-1 text-sm font-medium text-muted-foreground">Сброс</h2>
		</div>
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

		<div class="mt-4 border-t border-line/70 pt-3">
			<p class="mb-2 text-xs leading-relaxed text-muted-foreground">
				{#if deleted}
					Учётная запись удалена. Записи стёрты и здесь, и на сервере; данные о платежах сохранены —
					этого требует закон.
				{:else}
					Удаление учётной записи стирает записи и на сервере. Отменить это нельзя.
					{#if !session.isAuthenticated}
						Работает внутри Telegram: сервер отвечает только по подписи.
					{/if}
				{/if}
			</p>

			{#if deleteError}
				<p class="mb-2 text-xs leading-relaxed text-destructive">{deleteError}</p>
			{/if}

			{#if !deleted}
				<button
					type="button"
					onclick={askDelete}
					disabled={deleting || !session.isAuthenticated}
					class="w-full rounded-full border py-2.5 text-xs font-medium
					       transition-[transform,color,border-color] duration-500 ease-flux
					       active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40
					       {confirmingDelete
						? 'border-destructive bg-destructive/10 text-destructive'
						: 'border-line-strong text-muted-foreground'}"
				>
					{#if deleting}
						Удаляем…
					{:else if confirmingDelete}
						Нажмите ещё раз — это необратимо
					{:else}
						Удалить учётную запись
					{/if}
				</button>
			{/if}
		</div>
	</GlassCard>
</div>
