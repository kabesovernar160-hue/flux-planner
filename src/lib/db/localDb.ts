import type { DailyFinanceRecord, FinanceEntry } from '$lib/types/finance';
import type { Habit, HabitCompletion } from '$lib/types/habit';
import type { DailyNutritionRecord, FoodEntry } from '$lib/types/nutrition';
import type { PlanItem } from '$lib/types/plan';
import type { WeightEntry } from '$lib/types/weight';
import type {
	PlannerDocument,
	PlannerSettings,
	PlannerState,
	PlannerUser
} from '$lib/types/planner';
import { SCHEMA_VERSION } from '$lib/types/planner';
import type { SyncMeta } from '$lib/types/sync';
import { nowIso, resolveTimeZone } from '$lib/utils/date';
import { createId } from '$lib/utils/id';
import { getDriver, PLANNER_DOC_KEY, STORES, type StoreName } from './storage';

/* ───────────────────────────── Значения по умолчанию ───────────────────────────── */

export function createDefaultSettings(): PlannerSettings {
	return {
		calorieGoal: 2100,
		proteinGoal: 120,
		fatGoal: 70,
		carbsGoal: 230,
		waterGoalMl: 2500,
		dailyBudget: 3000,
		currency: 'RUB',
		locale: 'ru-RU'
	};
}

export function createDefaultUser(timezone?: string): PlannerUser {
	const timestamp = nowIso();
	return {
		telegramUserId: null,
		timezone: resolveTimeZone(timezone),
		createdAt: timestamp,
		updatedAt: timestamp
	};
}

export function createDefaultDocument(timezone?: string): PlannerDocument {
	return {
		schemaVersion: SCHEMA_VERSION,
		user: createDefaultUser(timezone),
		settings: createDefaultSettings(),
		settingsUpdatedAt: nowIso(),
		nutrition: {},
		finance: {}
	};
}

export function createDefaultState(timezone?: string): PlannerState {
	return {
		...createDefaultDocument(timezone),
		foodEntries: [],
		habits: [],
		habitCompletions: [],
		financeEntries: [],
		planItems: [],
		weightEntries: []
	};
}

/* ───────────────────────────── Проверка формы данных ───────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Записи проверяются поштучно и по отдельности отбрасываются.
 *
 * Одна испорченная запись не должна стоить пользователю всей истории:
 * валидные соседи по хранилищу загружаются как ни в чём не бывало.
 */
function sanitizeArray<T>(values: unknown, guard: (value: unknown) => value is T): T[] {
	if (!Array.isArray(values)) return [];
	// Удалённые записи отфильтровываются здесь, в одном месте: иначе их пришлось
	// бы вычитать в каждом производном значении и рано или поздно забыть.
	return values.filter(
		(value) => guard(value) && !(value as { deletedAt?: unknown }).deletedAt
	) as T[];
}

function isFoodEntry(value: unknown): value is FoodEntry {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.date) &&
		typeof value.name === 'string' &&
		isFiniteNumber(value.calories) &&
		isFiniteNumber(value.protein) &&
		isFiniteNumber(value.fat) &&
		isFiniteNumber(value.carbs)
	);
}

function isHabit(value: unknown): value is Habit {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.name) &&
		typeof value.icon === 'string' &&
		(value.frequency === 'daily' ||
			value.frequency === 'weekdays' ||
			value.frequency === 'custom') &&
		typeof value.archived === 'boolean'
	);
}

function isHabitCompletion(value: unknown): value is HabitCompletion {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.habitId) &&
		isNonEmptyString(value.date) &&
		typeof value.completed === 'boolean'
	);
}

function isPlanItem(value: unknown): value is PlanItem {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.date) &&
		isNonEmptyString(value.title) &&
		typeof value.done === 'boolean'
	);
}

function isWeightEntry(value: unknown): value is WeightEntry {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.date) &&
		isFiniteNumber(value.weightKg) &&
		value.weightKg > 0
	);
}

function isFinanceEntry(value: unknown): value is FinanceEntry {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.date) &&
		(value.type === 'expense' || value.type === 'income') &&
		isFiniteNumber(value.amount) &&
		isNonEmptyString(value.category)
	);
}

function isDailyNutrition(value: unknown): value is DailyNutritionRecord {
	return (
		isRecord(value) &&
		isNonEmptyString(value.date) &&
		isFiniteNumber(value.calorieGoal) &&
		isFiniteNumber(value.waterConsumedMl)
	);
}

function isDailyFinance(value: unknown): value is DailyFinanceRecord {
	return isRecord(value) && isNonEmptyString(value.date) && isFiniteNumber(value.budget);
}

/**
 * Достройка служебных полей записи дня.
 *
 * Цели и бюджет дня появились раньше, чем их синхронизация, и в уже
 * сохранённых документах идентификатора и отметок времени нет. Без них
 * запись не уедет на сервер, поэтому они проставляются при чтении —
 * ровно один раз, дальше живут вместе с записью.
 */
function withSyncMeta<T extends { date: string }>(record: T): T & SyncMeta {
	const existing = record as Partial<SyncMeta> & T;
	const timestamp = nowIso();

	return {
		...record,
		id: isNonEmptyString(existing.id) ? existing.id : createId(),
		createdAt: isNonEmptyString(existing.createdAt) ? existing.createdAt : timestamp,
		updatedAt: isNonEmptyString(existing.updatedAt) ? existing.updatedAt : timestamp,
		deletedAt: existing.deletedAt ?? null
	};
}

function sanitizeDailyMap<T>(
	value: unknown,
	guard: (candidate: unknown) => candidate is T,
	normalize: (entry: T) => T
): Record<string, T> {
	if (!isRecord(value)) return {};
	const result: Record<string, T> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (guard(entry)) result[key] = normalize(entry);
	}
	return result;
}

/* ───────────────────────────── Миграции ───────────────────────────── */

/**
 * Приведение сохранённого документа к текущей схеме.
 *
 * Возвращает null, если документ непригоден — тогда вызывающий код
 * создаёт состояние по умолчанию вместо падения.
 */
export function migrateDocument(raw: unknown): PlannerDocument | null {
	if (!isRecord(raw)) return null;

	const version = isFiniteNumber(raw.schemaVersion) ? raw.schemaVersion : 0;

	// Документ новее, чем понимает этот клиент: читать его опасно,
	// поля могли поменять смысл. Безопаснее начать заново.
	if (version > SCHEMA_VERSION) return null;

	// Версия 0 — данные до введения схемы. Пока таких в проде нет,
	// поэтому шаг миграции сводится к достройке отсутствующих полей.
	const defaults = createDefaultDocument();

	const user = isRecord(raw.user) ? raw.user : {};
	const settings = isRecord(raw.settings) ? raw.settings : {};

	return {
		schemaVersion: SCHEMA_VERSION,
		user: {
			...defaults.user,
			...user,
			telegramUserId: typeof user.telegramUserId === 'string' ? user.telegramUserId : null,
			timezone: isNonEmptyString(user.timezone) ? user.timezone : defaults.user.timezone
		},
		settings: { ...defaults.settings, ...settings },
		// У документов, сохранённых до появления отметки, берётся время записи
		// пользователя: это ближайшее известное «когда настройки были такими».
		settingsUpdatedAt: isNonEmptyString(raw.settingsUpdatedAt)
			? raw.settingsUpdatedAt
			: isNonEmptyString(user.updatedAt)
				? user.updatedAt
				: defaults.settingsUpdatedAt,
		nutrition: sanitizeDailyMap(raw.nutrition, isDailyNutrition, withSyncMeta),
		finance: sanitizeDailyMap(raw.finance, isDailyFinance, withSyncMeta)
	};
}

/**
 * Одна запись веса на день.
 *
 * Два устройства, взвесившиеся офлайн в один и тот же день, приходят
 * с разными случайными идентификаторами: сервер сливает их по паре
 * «пользователь + день», а локально после обмена лежат обе строки.
 * В дневнике это выглядело бы как два взвешивания подряд, поэтому
 * остаётся более свежая.
 */
function dedupeByDate(entries: WeightEntry[]): WeightEntry[] {
	const best = new Map<string, WeightEntry>();

	for (const entry of entries) {
		const current = best.get(entry.date);
		if (!current || entry.updatedAt > current.updatedAt) best.set(entry.date, entry);
	}

	return [...best.values()];
}

function hasDayRecordsWithoutMeta(raw: unknown): boolean {
	if (!isRecord(raw)) return false;

	for (const field of ['nutrition', 'finance'] as const) {
		const map = raw[field];
		if (!isRecord(map)) continue;

		for (const entry of Object.values(map)) {
			if (!isRecord(entry) || !isNonEmptyString(entry.id)) return true;
		}
	}

	return false;
}

/* ───────────────────────────── Репозиторий ───────────────────────────── */

/**
 * Сортировка по времени создания.
 *
 * getAll() в IndexedDB отдаёт записи в порядке первичного ключа, поэтому без
 * явной сортировки порядок зависел бы от формата id. Разрешение createdAt —
 * миллисекунда, а сид создаёт шесть привычек внутри одной, поэтому при
 * равенстве добираем сравнением по id: он сортируем по времени создания.
 */
function byCreatedAt<T extends { createdAt: string; id: string }>(items: T[]): T[] {
	return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function loadPlannerState(timezone?: string): Promise<PlannerState> {
	const driver = await getDriver();

	const [rawDoc, foods, habits, completions, finance, plan, weight] = await Promise.all([
		driver.get<unknown>(STORES.plannerState, PLANNER_DOC_KEY),
		driver.getAll<unknown>(STORES.foodEntries),
		driver.getAll<unknown>(STORES.habits),
		driver.getAll<unknown>(STORES.habitCompletions),
		driver.getAll<unknown>(STORES.financeEntries),
		driver.getAll<unknown>(STORES.planItems),
		driver.getAll<unknown>(STORES.weightEntries)
	]);

	const document = migrateDocument(rawDoc) ?? createDefaultDocument(timezone);

	// Достроенные служебные поля записываются обратно сразу: иначе каждое
	// чтение выдавало бы записи дня с новыми идентификаторами, и синхронизация
	// отправляла бы один и тот же день под разными ключами.
	if (hasDayRecordsWithoutMeta(rawDoc)) {
		await savePlannerDocument(document);
	}

	return {
		...document,
		foodEntries: byCreatedAt(sanitizeArray(foods, isFoodEntry)),
		habits: byCreatedAt(sanitizeArray(habits, isHabit)),
		habitCompletions: byCreatedAt(sanitizeArray(completions, isHabitCompletion)),
		financeEntries: byCreatedAt(sanitizeArray(finance, isFinanceEntry)),
		planItems: byCreatedAt(sanitizeArray(plan, isPlanItem)),
		// Вес сортируется по дню, а не по времени создания: записанное задним
		// числом должно встать в график на своё место, а не в конец.
		weightEntries: dedupeByDate(sanitizeArray<WeightEntry>(weight, isWeightEntry)).sort((a, b) =>
			a.date.localeCompare(b.date)
		)
	};
}

export async function savePlannerDocument(document: PlannerDocument): Promise<void> {
	const driver = await getDriver();
	await driver.put(STORES.plannerState, document, PLANNER_DOC_KEY);
}

/**
 * Полная перезапись состояния. Используется при сбросе и при первичном
 * наполнении; обычные правки идут через точечные save-методы ниже,
 * чтобы добавление одной траты не переписывало всю базу.
 */
export async function savePlannerState(state: PlannerState): Promise<void> {
	const driver = await getDriver();
	const {
		foodEntries,
		habits,
		habitCompletions,
		financeEntries,
		planItems,
		weightEntries,
		...document
	} = state;

	await savePlannerDocument(document);
	await Promise.all([
		driver.putMany(STORES.foodEntries, foodEntries),
		driver.putMany(STORES.habits, habits),
		driver.putMany(STORES.habitCompletions, habitCompletions),
		driver.putMany(STORES.financeEntries, financeEntries),
		driver.putMany(STORES.planItems, planItems),
		driver.putMany(STORES.weightEntries, weightEntries)
	]);
}

export async function saveFoodEntry(entry: FoodEntry): Promise<void> {
	await (await getDriver()).put(STORES.foodEntries, entry);
}

/**
 * Мягкое удаление.
 *
 * Запись не стирается, а помечается надгробием. Без этого удаление на одном
 * устройстве неотличимо от «этой записи тут ещё нет», и при следующей
 * синхронизации второе устройство вернуло бы её обратно.
 */
async function tombstone(store: StoreName, id: string): Promise<void> {
	const driver = await getDriver();
	const existing = await driver.get<Record<string, unknown>>(store, id);
	if (!existing) return;

	await driver.put(store, { ...existing, deletedAt: nowIso(), updatedAt: nowIso() });
}

export async function deleteFoodEntry(id: string): Promise<void> {
	await tombstone(STORES.foodEntries, id);
}

export async function saveHabit(habit: Habit): Promise<void> {
	await (await getDriver()).put(STORES.habits, habit);
}

export async function deleteHabit(id: string): Promise<void> {
	await tombstone(STORES.habits, id);
}

export async function saveHabitCompletion(completion: HabitCompletion): Promise<void> {
	await (await getDriver()).put(STORES.habitCompletions, completion);
}

export async function deleteHabitCompletion(id: string): Promise<void> {
	await tombstone(STORES.habitCompletions, id);
}

export async function savePlanItem(item: PlanItem): Promise<void> {
	await (await getDriver()).put(STORES.planItems, item);
}

export async function deletePlanItem(id: string): Promise<void> {
	await tombstone(STORES.planItems, id);
}

export async function saveFinanceEntry(entry: FinanceEntry): Promise<void> {
	await (await getDriver()).put(STORES.financeEntries, entry);
}

export async function deleteFinanceEntry(id: string): Promise<void> {
	await tombstone(STORES.financeEntries, id);
}

/**
 * Полная выгрузка таблицы вместе с надгробиями.
 *
 * Отдельно от loadPlannerState: приложению удалённые записи не нужны,
 * а синхронизации нужны именно они — иначе удаление не доедет до сервера.
 */
export async function saveWeightEntry(entry: WeightEntry): Promise<void> {
	await (await getDriver()).put(STORES.weightEntries, entry);
}

export async function deleteWeightEntry(id: string): Promise<void> {
	await tombstone(STORES.weightEntries, id);
}

export async function loadRawForSync<T>(store: StoreName): Promise<T[]> {
	return (await getDriver()).getAll<T>(store);
}

/**
 * Пакетная запись при импорте.
 *
 * По одной транзакции на запись превращает восстановление годовой истории
 * в тысячу обращений к диску. Здесь на каждую коллекцию приходится одна.
 */
export async function saveImportedEntries(entries: {
	foodEntries?: FoodEntry[];
	habits?: Habit[];
	habitCompletions?: HabitCompletion[];
	financeEntries?: FinanceEntry[];
	planItems?: PlanItem[];
	weightEntries?: WeightEntry[];
}): Promise<void> {
	const driver = await getDriver();

	const pairs: [StoreName, unknown[] | undefined][] = [
		[STORES.foodEntries, entries.foodEntries],
		[STORES.habits, entries.habits],
		[STORES.habitCompletions, entries.habitCompletions],
		[STORES.financeEntries, entries.financeEntries],
		[STORES.planItems, entries.planItems],
		[STORES.weightEntries, entries.weightEntries]
	];

	for (const [store, values] of pairs) {
		if (values && values.length > 0) await driver.putMany(store, values);
	}
}

/* ───────────────────────────── Записи дня для синхронизации ───────────────────────────── */

/**
 * Цели и бюджет дня живут внутри документа под ключом-датой, а в протоколе
 * ходят обычными строками. Перевод из одного в другое собран здесь: очередь
 * синхронизации не должна знать, как устроено локальное хранилище.
 */
export type DayCollection = 'nutritionDays' | 'financeDays';

export async function loadDayRecordsForSync(
	collection: DayCollection
): Promise<(SyncMeta & { date: string })[]> {
	const driver = await getDriver();
	const document = migrateDocument(await driver.get<unknown>(STORES.plannerState, PLANNER_DOC_KEY));
	if (!document) return [];

	return Object.values(
		collection === 'nutritionDays' ? document.nutrition : document.finance
	) as (SyncMeta & { date: string })[];
}

function mergeDayRows<T extends { date: string }>(
	target: Record<string, T & SyncMeta>,
	rows: unknown[],
	guard: (value: unknown) => value is T
): boolean {
	let changed = false;

	for (const row of rows) {
		if (!guard(row)) continue;

		const incoming = withSyncMeta(row);
		const existing = target[incoming.date];

		// Побеждает последняя правка — то же правило, по которому сливает сервер.
		if (existing && existing.updatedAt >= incoming.updatedAt) continue;

		if (incoming.deletedAt) {
			// Дни не удаляют, но если надгробие пришло — уважаем его,
			// иначе запись воскресала бы при каждой синхронизации.
			delete target[incoming.date];
		} else {
			target[incoming.date] = incoming;
		}

		changed = true;
	}

	return changed;
}

/** Приём записей дня с сервера. Документ переписывается только при изменениях. */
export async function mergeDayRecordsFromSync(
	collection: DayCollection,
	rows: unknown[]
): Promise<void> {
	if (rows.length === 0) return;

	const driver = await getDriver();
	const document =
		migrateDocument(await driver.get<unknown>(STORES.plannerState, PLANNER_DOC_KEY)) ??
		createDefaultDocument();

	const changed =
		collection === 'nutritionDays'
			? mergeDayRows(document.nutrition, rows, isDailyNutrition)
			: mergeDayRows(document.finance, rows, isDailyFinance);

	if (changed) await savePlannerDocument(document);
}

/**
 * Уборка задвоенных взвешиваний в хранилище.
 *
 * Чтение и так показывает по одной записи на день, но лишняя строка
 * продолжала бы уезжать на сервер при каждой правке. Надгробия не трогаем:
 * без них удаление не доедет до других устройств.
 */
export async function dedupeWeightEntries(): Promise<void> {
	const driver = await getDriver();
	const rows = await driver.getAll<WeightEntry>(STORES.weightEntries);

	const best = new Map<string, WeightEntry>();
	const extra: string[] = [];

	for (const row of rows) {
		if (!isWeightEntry(row) || row.deletedAt) continue;

		const current = best.get(row.date);
		if (!current) {
			best.set(row.date, row);
			continue;
		}

		const newer = row.updatedAt > current.updatedAt ? row : current;
		const older = newer === row ? current : row;
		best.set(row.date, newer);
		extra.push(older.id);
	}

	for (const id of extra) await driver.delete(STORES.weightEntries, id);
}

/**
 * Приём настроек с сервера.
 *
 * Настройки — единственный документ, а не коллекция: построчного слияния
 * у них нет, побеждает более свежая версия целиком. Без этого приёма цели,
 * изменённые на телефоне, не появлялись на планшете никогда: отправлялись
 * они исправно, а обратно не читались.
 */
export async function mergeSettingsFromSync(
	settings: unknown,
	updatedAt: string
): Promise<boolean> {
	if (!isRecord(settings) || !isNonEmptyString(updatedAt)) return false;

	const driver = await getDriver();
	const document =
		migrateDocument(await driver.get<unknown>(STORES.plannerState, PLANNER_DOC_KEY)) ??
		createDefaultDocument();

	if (updatedAt <= document.settingsUpdatedAt) return false;

	document.settings = { ...createDefaultSettings(), ...settings };
	document.settingsUpdatedAt = updatedAt;

	await savePlannerDocument(document);
	return true;
}

export async function clearAllData(): Promise<void> {
	await (await getDriver()).clearAll();
}

export async function getStorageKind(): Promise<'indexeddb' | 'memory'> {
	return (await getDriver()).kind;
}
