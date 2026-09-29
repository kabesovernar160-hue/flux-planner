<script lang="ts">
	import {
		ArrowsClockwise,
		CloudCheck,
		CloudSlash,
		DownloadSimple,
		Trash,
		UploadSimple,
		UserMinus
	} from 'phosphor-svelte';
	import SettingsGroup from '$lib/components/settings/settings-group.svelte';
	import SettingsRow from '$lib/components/settings/settings-row.svelte';
	import { syncLabel } from '$lib/components/settings/sync-label';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { syncQueue } from '$lib/db/syncQueue.svelte';
	import { deleteAccount } from '$lib/services/accountService';
	import { importFromFile } from '$lib/services/importService';
	import { session } from '$lib/state/session.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { nowIso, resolveTimeZone } from '$lib/utils/date';
	import { buildExport, exportFileName, toFoodCsv, toWeightCsv } from '$lib/utils/exportData';

	const settings = $derived(plannerStore.doc.settings);

	const sessionLabel = $derived.by(() => {
		switch (session.status) {
			case 'authenticated':
				return `Вход выполнен${session.user?.username ? ` · @${session.user.username}` : ''}`;
			case 'authenticating':
				return 'Проверяем подпись Telegram…';
			case 'local':
				return 'Открыто вне Telegram';
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

	const syncBroken = $derived(
		!session.isAuthenticated || syncQueue.status === 'offline' || syncQueue.status === 'error'
	);

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

	function exportFoodCsv() {
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

	/**
	 * Удаление учётной записи — в два нажатия и с отдельным текстом.
	 *
	 * Оно необратимо и, в отличие от сброса, стирает данные и на сервере.
	 * Поэтому у него своя строка со своим пояснением: одна кнопка рядом
	 * со «Стереть локальные данные» неизбежно была бы нажата не та.
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

	$effect(() => () => {
		if (resetTimer) clearTimeout(resetTimer);
		if (deleteTimer) clearTimeout(deleteTimer);
	});

	const deleteLabel = $derived(
		deleting
			? 'Удаляем…'
			: confirmingDelete
				? 'Нажмите ещё раз — это необратимо'
				: 'Удалить учётную запись'
	);
</script>

<svelte:head>
	<title>Данные и синхронизация — Flux Planner</title>
</svelte:head>

<PageHeader title="Данные" subtitle={sessionLabel} back="/settings" />

{#snippet syncButton()}
	<button
		type="button"
		onclick={() => {
			telegram.haptic.impact('light');
			void syncQueue.syncNow();
		}}
		disabled={!session.isAuthenticated}
		aria-label="Синхронизировать сейчас"
		class="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong
		       text-muted-foreground transition-[transform,border-color] duration-500 ease-flux
		       hover:border-tone/60 active:scale-90 disabled:pointer-events-none disabled:opacity-40"
	>
		<ArrowsClockwise
			size={15}
			weight="light"
			class={syncQueue.status === 'syncing' ? 'animate-spin' : ''}
		/>
	</button>
{/snippet}

{#snippet info(label: string, value: string)}
	<div class="group/row flex min-h-11 items-center pl-4">
		<div
			class="flex min-h-11 min-w-0 flex-1 items-center gap-3 self-stretch border-t border-line/60
			       py-2 pr-4 group-first/row:border-t-0"
		>
			<span class="min-w-0 flex-1 text-sm text-muted-foreground">{label}</span>
			<span class="tabular min-w-0 truncate text-right text-sm">{value}</span>
		</div>
	</div>
{/snippet}

<div class="flex flex-col gap-4">
	<SettingsGroup
		title="Синхронизация"
		step={0}
		footer={session.isAuthenticated
			? undefined
			: 'Синхронизация работает внутри Telegram: сервер принимает данные только по подписи Telegram. Здесь всё сохраняется локально.'}
	>
		<SettingsRow
			icon={syncBroken ? CloudSlash : CloudCheck}
			label={syncLabel(syncQueue.status, session.isAuthenticated)}
			hint={lastSynced ? `Последний обмен: ${lastSynced}` : 'Обмена с сервером ещё не было'}
			trailing={syncButton}
		/>
	</SettingsGroup>

	<SettingsGroup title="Устройство" step={1}>
		{@render info('Часовой пояс', resolveTimeZone(plannerStore.doc.user.timezone))}
		{@render info(
			'Хранилище',
			plannerStore.status === 'memory' ? 'память (временное)' : 'IndexedDB'
		)}
		{@render info(
			'Записей',
			`еда ${plannerStore.foodEntries.length} · траты ${plannerStore.financeEntries.length}`
		)}
	</SettingsGroup>

	<SettingsGroup
		title="Выгрузка и восстановление"
		step={2}
		footer="JSON — полный снимок, CSV — таблица для Excel или Google Таблиц. Снимок принимается обратно: записи сливаются по времени изменения, свежее побеждает."
	>
		<SettingsRow icon={DownloadSimple} label="Полный снимок" value="JSON" onclick={exportJson} />
		<SettingsRow
			icon={DownloadSimple}
			label="Еда"
			value="CSV"
			hint={plannerStore.foodEntries.length === 0 ? 'Записей о еде пока нет' : undefined}
			disabled={plannerStore.foodEntries.length === 0}
			onclick={exportFoodCsv}
		/>
		<SettingsRow
			icon={DownloadSimple}
			label="Вес"
			value="CSV"
			hint={plannerStore.weightEntries.length === 0 ? 'Взвешиваний пока нет' : undefined}
			disabled={plannerStore.weightEntries.length === 0}
			onclick={exportWeightCsv}
		/>
		<SettingsRow
			icon={UploadSimple}
			for="import-file"
			label={importing ? 'Читаем файл…' : 'Восстановить из JSON'}
			disabled={importing}
		/>
	</SettingsGroup>

	<!--
		Поле выбора файла вне списка: строка-подпись выше открывает его по for,
		а в самом списке оно сбивало бы разделитель у первой строки.
	-->
	<input
		id="import-file"
		type="file"
		accept="application/json,.json"
		onchange={handleImport}
		disabled={importing}
		class="sr-only"
	/>

	{#if importMessage}
		<p
			role="status"
			class="-mt-2 px-1 text-xs leading-relaxed {importFailed
				? 'text-destructive'
				: 'text-muted-foreground'}"
		>
			{importMessage}
		</p>
	{/if}

	<!--
		Необратимые действия — внизу, отдельной группой с красной подписью
		и границей: до них доходят, только если идут за ними намеренно.
		Каждое подтверждается вторым нажатием в течение пяти секунд.
	-->
	<div id="danger" class="scroll-mt-4">
		<SettingsGroup title="Опасная зона" step={3} danger>
			<SettingsRow
				icon={Trash}
				tone="danger"
				label={confirmingReset ? 'Нажмите ещё раз, чтобы стереть' : 'Стереть локальные данные'}
				hint="Удалит с этого устройства еду, привычки и траты. Уже уехавшее на сервер вернётся при следующей синхронизации."
				onclick={askReset}
				class={confirmingReset ? 'bg-destructive/15' : undefined}
			/>
			{#if !deleted}
				<SettingsRow
					icon={UserMinus}
					tone="danger"
					label={deleteLabel}
					hint={session.isAuthenticated
						? 'Стирает записи и на сервере. Отменить это нельзя.'
						: 'Стирает записи и на сервере. Работает внутри Telegram: сервер отвечает только по подписи.'}
					disabled={deleting || !session.isAuthenticated}
					onclick={askDelete}
					class={confirmingDelete ? 'bg-destructive/15' : undefined}
				/>
			{/if}
		</SettingsGroup>

		{#if deleted}
			<p role="status" class="mt-2 px-1 text-xs leading-relaxed text-muted-foreground">
				Учётная запись удалена. Записи стёрты и здесь, и на сервере; данные о платежах сохранены —
				этого требует закон.
			</p>
		{/if}

		{#if deleteError}
			<p role="alert" class="mt-2 px-1 text-xs leading-relaxed text-destructive">{deleteError}</p>
		{/if}
	</div>
</div>
