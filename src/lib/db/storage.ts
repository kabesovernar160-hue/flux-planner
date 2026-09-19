/**
 * Низкоуровневый доступ к хранилищу.
 *
 * Наружу торчит один интерфейс StorageDriver с двумя реализациями:
 * IndexedDB и память. Память — не заглушка для тестов, а рабочий режим
 * деградации: в приватном окне, при запрете хранилища в настройках или
 * при повреждённой базе приложение обязано продолжать работать,
 * просто без переживания перезагрузки.
 */

export const DB_NAME = 'flux-planner';
/**
 * Версия схемы IndexedDB.
 *
 * Поднимается при добавлении хранилища: onupgradeneeded выполняется только
 * при росте номера, и без этого у тех, кто уже открывал приложение,
 * новое хранилище просто не появится.
 */
export const DB_VERSION = 2;

export const STORES = {
	plannerState: 'plannerState',
	foodEntries: 'foodEntries',
	habits: 'habits',
	habitCompletions: 'habitCompletions',
	financeEntries: 'financeEntries',
	planItems: 'planItems'
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/** Singleton-документ лежит под фиксированным ключом. */
export const PLANNER_DOC_KEY = 'current';

export interface StorageDriver {
	readonly kind: 'indexeddb' | 'memory';
	get<T>(store: StoreName, key: string): Promise<T | undefined>;
	getAll<T>(store: StoreName): Promise<T[]>;
	put(store: StoreName, value: unknown, key?: string): Promise<void>;
	putMany(store: StoreName, values: unknown[]): Promise<void>;
	delete(store: StoreName, key: string): Promise<void>;
	clear(store: StoreName): Promise<void>;
	clearAll(): Promise<void>;
}

/* ───────────────────────────── IndexedDB ───────────────────────────── */

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
	});
}

function isIndexedDbAvailable(): boolean {
	try {
		// Само обращение к глобалу бросает в части приватных режимов,
		// поэтому проверка обёрнута в try, а не сводится к typeof.
		return typeof indexedDB !== 'undefined' && indexedDB !== null;
	} catch {
		return false;
	}
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open(DB_NAME, DB_VERSION);

		open.onupgradeneeded = () => {
			const db = open.result;

			// Документ состояния — вне строки: ключ передаётся явно.
			if (!db.objectStoreNames.contains(STORES.plannerState)) {
				db.createObjectStore(STORES.plannerState);
			}

			// Коллекции — по id, с индексами под выборки по дню.
			if (!db.objectStoreNames.contains(STORES.foodEntries)) {
				db.createObjectStore(STORES.foodEntries, { keyPath: 'id' }).createIndex('date', 'date');
			}
			if (!db.objectStoreNames.contains(STORES.habits)) {
				db.createObjectStore(STORES.habits, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(STORES.habitCompletions)) {
				const store = db.createObjectStore(STORES.habitCompletions, { keyPath: 'id' });
				store.createIndex('date', 'date');
				store.createIndex('habitId', 'habitId');
			}
			if (!db.objectStoreNames.contains(STORES.financeEntries)) {
				db.createObjectStore(STORES.financeEntries, { keyPath: 'id' }).createIndex('date', 'date');
			}
			if (!db.objectStoreNames.contains(STORES.planItems)) {
				db.createObjectStore(STORES.planItems, { keyPath: 'id' }).createIndex('date', 'date');
			}
		};

		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error ?? new Error('Cannot open IndexedDB'));
		// Открытие висит, если другая вкладка держит старую версию базы.
		open.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
	});
}

class IndexedDbDriver implements StorageDriver {
	readonly kind = 'indexeddb' as const;

	constructor(private db: IDBDatabase) {}

	#tx(store: StoreName, mode: IDBTransactionMode) {
		return this.db.transaction(store, mode).objectStore(store);
	}

	async get<T>(store: StoreName, key: string): Promise<T | undefined> {
		return request<T | undefined>(this.#tx(store, 'readonly').get(key));
	}

	async getAll<T>(store: StoreName): Promise<T[]> {
		return request<T[]>(this.#tx(store, 'readonly').getAll());
	}

	async put(store: StoreName, value: unknown, key?: string): Promise<void> {
		await request(this.#tx(store, 'readwrite').put(value, key));
	}

	async putMany(store: StoreName, values: unknown[]): Promise<void> {
		if (values.length === 0) return;
		// Одна транзакция на всю пачку: по транзакции на запись превращает
		// гидратацию сотни записей в сотню обращений к диску.
		const tx = this.db.transaction(store, 'readwrite');
		const objectStore = tx.objectStore(store);
		for (const value of values) objectStore.put(value);

		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
			tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
		});
	}

	async delete(store: StoreName, key: string): Promise<void> {
		await request(this.#tx(store, 'readwrite').delete(key));
	}

	async clear(store: StoreName): Promise<void> {
		await request(this.#tx(store, 'readwrite').clear());
	}

	async clearAll(): Promise<void> {
		for (const store of Object.values(STORES)) await this.clear(store);
	}
}

/* ────────────────────────────── Память ────────────────────────────── */

class MemoryDriver implements StorageDriver {
	readonly kind = 'memory' as const;

	#data = new Map<StoreName, Map<string, unknown>>();

	#store(name: StoreName): Map<string, unknown> {
		let store = this.#data.get(name);
		if (!store) {
			store = new Map();
			this.#data.set(name, store);
		}
		return store;
	}

	#keyOf(store: StoreName, value: unknown, key?: string): string {
		if (key !== undefined) return key;
		const id = (value as { id?: unknown })?.id;
		if (typeof id === 'string') return id;
		throw new Error(`Cannot derive key for store ${store}`);
	}

	async get<T>(store: StoreName, key: string): Promise<T | undefined> {
		return this.#store(store).get(key) as T | undefined;
	}

	async getAll<T>(store: StoreName): Promise<T[]> {
		return [...this.#store(store).values()] as T[];
	}

	async put(store: StoreName, value: unknown, key?: string): Promise<void> {
		this.#store(store).set(this.#keyOf(store, value, key), value);
	}

	async putMany(store: StoreName, values: unknown[]): Promise<void> {
		for (const value of values) await this.put(store, value);
	}

	async delete(store: StoreName, key: string): Promise<void> {
		this.#store(store).delete(key);
	}

	async clear(store: StoreName): Promise<void> {
		this.#store(store).clear();
	}

	async clearAll(): Promise<void> {
		this.#data.clear();
	}
}

/* ───────────────────────────── Выбор драйвера ───────────────────────────── */

let driverPromise: Promise<StorageDriver> | null = null;

async function selectDriver(): Promise<StorageDriver> {
	if (!isIndexedDbAvailable()) return new MemoryDriver();

	try {
		return new IndexedDbDriver(await openDatabase());
	} catch {
		// Открыть базу не удалось (квота, приватный режим, блокировка другой
		// вкладкой). Приложение продолжает работать в памяти.
		return new MemoryDriver();
	}
}

/** Драйвер создаётся один раз за время жизни страницы. */
export function getDriver(): Promise<StorageDriver> {
	driverPromise ??= selectDriver();
	return driverPromise;
}

/** Сброс кеша драйвера. Нужен тестам, чтобы каждый кейс стартовал с чистой базы. */
export function resetDriverForTests(): void {
	driverPromise = null;
}
