import {
	dedupeWeightEntries,
	hasStoredDocument,
	loadDayRecordsForSync,
	loadRawForSync,
	mergeDayRecordsFromSync,
	mergeSettingsFromSync,
	SETTINGS_NEVER_SAVED
} from './localDb';
import { getDriver, STORES, type StoreName } from './storage';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { telegram } from '$lib/telegram';
import { nowIso } from '$lib/utils/date';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

/** Коллекции-таблицы: каждая лежит в своём хранилище IndexedDB. */
type EntryCollection = 'food' | 'habits' | 'completions' | 'finance' | 'plan' | 'weight';

/**
 * Коллекции-дни: цели и бюджет дня.
 *
 * В интерфейсе это часть документа, а не список записей, но синхронизация
 * не должна об этом знать: без них вода и цели дня остаются на устройстве,
 * а вечерняя сводка в чате рассказывает про чужие числа.
 */
type DayCollection = 'nutritionDays' | 'financeDays';

type Collection = EntryCollection | DayCollection;

const STORE_BY_COLLECTION: Record<EntryCollection, StoreName> = {
	food: STORES.foodEntries,
	habits: STORES.habits,
	completions: STORES.habitCompletions,
	finance: STORES.financeEntries,
	plan: STORES.planItems,
	weight: STORES.weightEntries
};

const DAY_COLLECTIONS: DayCollection[] = ['nutritionDays', 'financeDays'];

function isDayCollection(collection: string): collection is DayCollection {
	return collection === 'nutritionDays' || collection === 'financeDays';
}

const WATERMARK_KEY = 'flux-planner:sync-watermark';

/** Ступени повтора. Последняя не повторяется бесконечно — цикл конечен. */
const BACKOFF_MS = [2_000, 8_000, 30_000, 120_000];

interface Watermark {
	/** Отметка сервера из последнего успешного pull. */
	pulledAt: string | null;
	/** Момент последнего успешного push: всё, что новее, ещё не отправлено. */
	pushedAt: string | null;
}

function readWatermark(): Watermark {
	try {
		const raw = localStorage.getItem(WATERMARK_KEY);
		if (!raw) return { pulledAt: null, pushedAt: null };

		const parsed = JSON.parse(raw) as Partial<Watermark>;
		return {
			pulledAt: typeof parsed.pulledAt === 'string' ? parsed.pulledAt : null,
			pushedAt: typeof parsed.pushedAt === 'string' ? parsed.pushedAt : null
		};
	} catch {
		// Приватный режим или испорченное значение: работаем как при первом запуске.
		return { pulledAt: null, pushedAt: null };
	}
}

function writeWatermark(watermark: Watermark): void {
	try {
		localStorage.setItem(WATERMARK_KEY, JSON.stringify(watermark));
	} catch {
		// Не судьба — следующая синхронизация просто заберёт больше данных.
	}
}

/**
 * Очередь синхронизации.
 *
 * Отдельного журнала изменений нет намеренно. Каждая запись несёт updatedAt,
 * поэтому «что ещё не отправлено» вычисляется как «всё, что новее водяного
 * знака». Журнал пришлось бы держать в согласии с данными, и потеря одной
 * его записи означала бы потерю изменения навсегда.
 */
class SyncQueue {
	status = $state<SyncStatus>('idle');
	lastSyncedAt = $state<string | null>(null);
	lastError = $state<string | null>(null);

	/** Есть непереданные изменения. Ставится мутациями, снимается после push. */
	pending = $state(false);

	#attempt = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#running: Promise<void> | null = null;

	/**
	 * Пометить, что появились изменения.
	 *
	 * Само изменение уже лежит в IndexedDB — здесь только планируется отправка,
	 * с небольшой задержкой, чтобы серия правок ушла одним пакетом.
	 */
	queueChange(): void {
		this.pending = true;
		this.#schedule(1_500);
	}

	#schedule(delay: number): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.syncPendingChanges(), delay);
	}

	dispose(): void {
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
	}

	/**
	 * Забыть, что и когда синхронизировалось.
	 *
	 * Нужно после удаления учётной записи: с прежними водяными знаками
	 * следующий обмен решил бы, что всё давно отправлено, и не заметил бы,
	 * что на устройстве теперь пусто.
	 */
	forget(): void {
		try {
			localStorage.removeItem(WATERMARK_KEY);
		} catch {
			// Приватный режим: знаков там и не было.
		}

		this.lastSyncedAt = null;
		this.pending = false;
		this.status = 'idle';
	}

	/** Синхронизировать, если есть что. Повторный вызов присоединяется к текущей попытке. */
	syncPendingChanges(): Promise<void> {
		this.#running ??= this.#run().finally(() => {
			this.#running = null;
		});
		return this.#running;
	}

	/** Синхронизировать немедленно, не дожидаясь задержки. */
	syncNow(): Promise<void> {
		this.dispose();
		return this.syncPendingChanges();
	}

	getSyncStatus(): { status: SyncStatus; lastSyncedAt: string | null; pending: boolean } {
		return { status: this.status, lastSyncedAt: this.lastSyncedAt, pending: this.pending };
	}

	async #collectChanges(since: string | null): Promise<Record<Collection, unknown[]>> {
		const changes = {} as Record<Collection, unknown[]>;

		const changedSince = (rows: { updatedAt?: string }[]) =>
			since
				? rows.filter((row) => typeof row.updatedAt === 'string' && row.updatedAt > since)
				: rows;

		for (const [collection, store] of Object.entries(STORE_BY_COLLECTION) as [
			EntryCollection,
			StoreName
		][]) {
			// Надгробия тоже уезжают: без них удаление не доедет до сервера.
			changes[collection] = changedSince(await loadRawForSync<{ updatedAt?: string }>(store));
		}

		for (const collection of DAY_COLLECTIONS) {
			changes[collection] = changedSince(await loadDayRecordsForSync(collection));
		}

		return changes;
	}

	async #run(): Promise<void> {
		if (!telegram.isEmbedded || !telegram.initData) {
			// Вне Telegram синхронизировать нечем: подписи нет, сервер откажет.
			// Данные остаются локально — это штатный режим, а не ошибка.
			this.status = 'idle';
			return;
		}

		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			this.status = 'offline';
			this.#scheduleRetry();
			return;
		}

		this.status = 'syncing';
		this.lastError = null;

		const headers = {
			'content-type': 'application/json',
			'x-telegram-init-data': telegram.initData
		};

		try {
			const watermark = readWatermark();

			// Хранилище устройства пустое — значит, своего у нас нет: ни данных,
			// ни права на водяной знак. Знак живёт в localStorage и переживает
			// чистку IndexedDB по отдельности, а с ним сервер отдал бы только
			// «изменения с тех пор», то есть ничего, и человек остался бы
			// с пустым приложением при полной базе на сервере.
			const fresh = !(await hasStoredDocument());

			// Сначала отдаём своё, потом забираем чужое: так изменение,
			// сделанное только что, не будет затёрто более старой серверной
			// версией той же записи.
			const changes = await this.#collectChanges(fresh ? null : watermark.pushedAt);
			const pushedAt = nowIso();

			const pushResponse = await fetch('/api/sync/push', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					changes,
					// Нетронутые настройки не отправляются вовсе. Иначе значения
					// по умолчанию с пустого устройства выглядели бы на сервере
					// как свежая правка и стирали бы анкету и цели.
					...(plannerStore.doc.settingsUpdatedAt === SETTINGS_NEVER_SAVED
						? {}
						: {
								settings: plannerStore.doc.settings,
								settingsUpdatedAt: plannerStore.doc.settingsUpdatedAt
							})
				})
			});

			if (!pushResponse.ok) throw new Error(`push ${pushResponse.status}`);

			const pullUrl =
				watermark.pulledAt && !fresh
					? `/api/sync/pull?since=${encodeURIComponent(watermark.pulledAt)}`
					: '/api/sync/pull';

			const pullResponse = await fetch(pullUrl, { headers });
			if (!pullResponse.ok) throw new Error(`pull ${pullResponse.status}`);

			const payload = (await pullResponse.json()) as {
				changes: Partial<Record<Collection, { id: string }[]>>;
				serverTime: string;
				settings?: unknown;
				settingsUpdatedAt?: string | null;
			};

			await this.#applyIncoming(payload.changes);

			// Настройки приезжают целиком, а не построчно: у документа нет
			// слияния по записям, побеждает более свежая версия.
			if (payload.settingsUpdatedAt) {
				await mergeSettingsFromSync(payload.settings, payload.settingsUpdatedAt);
			}

			writeWatermark({ pulledAt: payload.serverTime, pushedAt });
			this.lastSyncedAt = payload.serverTime;
			this.pending = false;
			this.status = 'idle';
			this.#attempt = 0;

			// Перечитываем состояние: пришедшие записи должны попасть в интерфейс.
			await plannerStore.rehydrate();
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : 'Не удалось синхронизировать';
			this.status = 'error';
			this.#scheduleRetry();
		}
	}

	async #applyIncoming(changes: Partial<Record<Collection, { id: string }[]>>): Promise<void> {
		const driver = await getDriver();

		for (const [collection, rows] of Object.entries(changes) as [Collection, { id: string }[]][]) {
			if (!Array.isArray(rows) || rows.length === 0) continue;

			if (isDayCollection(collection)) {
				await mergeDayRecordsFromSync(collection, rows);
				continue;
			}

			const store = STORE_BY_COLLECTION[collection];
			// Коллекция, которой этот клиент ещё не знает, пропускается молча.
			// Обращение к хранилищу с именем undefined уронило бы всю
			// синхронизацию из-за одного нового поля в протоколе.
			if (!store) continue;

			await driver.putMany(store, rows);

			// Пришедшее взвешивание может повторить день, записанный локально
			// под другим идентификатором: сервер слил их по дню, здесь
			// остаётся убрать лишнюю строку.
			if (collection === 'weight') await dedupeWeightEntries();
		}
	}

	/**
	 * Повтор с растущей паузой.
	 *
	 * Число попыток конечно: бесконечный ретрай при лежащем сервере съедает
	 * батарею и трафик, а пользователю не помогает. После последней ступени
	 * синхронизация ждёт следующего изменения или явного syncNow.
	 */
	#scheduleRetry(): void {
		if (this.#attempt >= BACKOFF_MS.length) {
			this.#attempt = 0;
			return;
		}

		this.#schedule(BACKOFF_MS[this.#attempt]);
		this.#attempt += 1;
	}
}

export const syncQueue = new SyncQueue();
