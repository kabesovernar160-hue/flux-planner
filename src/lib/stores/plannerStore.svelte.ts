import * as db from '$lib/db/localDb';
import type {
	DailyFinance,
	DailyFinanceRecord,
	FinanceCategory,
	FinanceEntry
} from '$lib/types/finance';
import type { Habit, HabitCompletion, HabitFrequency } from '$lib/types/habit';
import type { DailyNutrition, DailyNutritionRecord, FoodEntry } from '$lib/types/nutrition';
import type { PlanItem } from '$lib/types/plan';
import type { WeightEntry } from '$lib/types/weight';
import type {
	PlannerDocument,
	PlannerSettings,
	PlannerUser,
	StoreStatus
} from '$lib/types/planner';
import { addDays, getToday, msUntilNextMidnight, nowIso, type DateKey } from '$lib/utils/date';
import { scheduledHabits } from '$lib/utils/habitFrequency';
import { calculateDayStreak, calculateLongestDayStreak } from '$lib/utils/streak';
import { createId } from '$lib/utils/id';
import { progressRatio } from '$lib/utils/nutrition';

/**
 * Доля выполнения, 0…1.
 *
 * Реализация одна и живёт в utils/nutrition: иначе появились бы два разных
 * ответа на вопрос «сколько процентов» — один здесь, другой в движке расчётов.
 */
const ratio = progressRatio;

function sum(values: number[]): number {
	return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export type FoodEntryInput = Omit<FoodEntry, 'id' | 'createdAt' | 'updatedAt' | 'date'> & {
	date?: DateKey;
};

export type PlanItemInput = Omit<PlanItem, 'id' | 'createdAt' | 'updatedAt' | 'date' | 'done'> & {
	date?: DateKey;
	done?: boolean;
};

export interface ImportSummary {
	added: number;
	updated: number;
	/** Пропущено: испорченные записи и те, что старше уже имеющихся. */
	skipped: number;
}

export type HabitInput = {
	name: string;
	icon: string;
	frequency: HabitFrequency;
	targetDays?: number[];
};

export type FinanceEntryInput = Omit<FinanceEntry, 'id' | 'createdAt' | 'updatedAt' | 'date'> & {
	date?: DateKey;
};

/**
 * Единственный источник истины приложения.
 *
 * Запись в хранилище идёт сквозной: каждый мутирующий метод сам сохраняет
 * затронутую запись. Альтернатива — общий $effect, следящий за всем
 * состоянием, — замыкает петлю state → save → load → state и на гидратации
 * немедленно перезаписывает только что прочитанные данные.
 *
 * Производные значения нигде не хранятся: они вычисляются из записей.
 */
export class PlannerStore {
	/* ───────────────── Состояние ───────────────── */

	doc = $state<PlannerDocument>(db.createDefaultDocument());

	foodEntries = $state<FoodEntry[]>([]);
	habits = $state<Habit[]>([]);
	habitCompletions = $state<HabitCompletion[]>([]);
	financeEntries = $state<FinanceEntry[]>([]);
	planItems = $state<PlanItem[]>([]);
	weightEntries = $state<WeightEntry[]>([]);

	/** Выбранный день. Меняется пользователем или переходом полуночи. */
	currentDate = $state<DateKey>(getToday());

	status = $state<StoreStatus>('idle');

	/** Следовать ли за сегодняшним днём. Сбрасывается при ручном выборе даты. */
	#followToday = true;
	#midnightTimer: ReturnType<typeof setTimeout> | null = null;
	#hydration: Promise<void> | null = null;

	/* ───────────────── Жизненный цикл ───────────────── */

	/**
	 * Гидратация из локального хранилища.
	 *
	 * Идемпотентна: повторные вызовы возвращают тот же промис. UI к этому
	 * моменту уже отрисован на безопасных значениях по умолчанию и просто
	 * перерисуется, когда данные приедут.
	 */
	initialize(): Promise<void> {
		this.#hydration ??= this.#hydrate();
		return this.#hydration;
	}

	#applyState(state: Awaited<ReturnType<typeof db.loadPlannerState>>): void {
		this.doc = {
			schemaVersion: state.schemaVersion,
			user: state.user,
			settings: state.settings,
			settingsUpdatedAt: state.settingsUpdatedAt,
			nutrition: state.nutrition,
			finance: state.finance
		};
		this.foodEntries = state.foodEntries;
		this.habits = state.habits;
		this.habitCompletions = state.habitCompletions;
		this.financeEntries = state.financeEntries;
		this.planItems = state.planItems;
		this.weightEntries = state.weightEntries;
	}

	/**
	 * Перечитать состояние из хранилища.
	 *
	 * Нужно после приёма изменений с сервера: синхронизация пишет напрямую
	 * в IndexedDB, и без перечитывания интерфейс останется на старых данных.
	 */
	async rehydrate(): Promise<void> {
		try {
			this.#applyState(await db.loadPlannerState(this.doc.user.timezone));
		} catch {
			// Чтение не удалось — остаёмся на том, что уже в памяти.
		}
	}

	async #hydrate(): Promise<void> {
		this.status = 'hydrating';

		try {
			const state = await db.loadPlannerState(this.doc.user.timezone);
			this.#applyState(state);

			this.currentDate = getToday(state.user.timezone);
			this.status = (await db.getStorageKind()) === 'memory' ? 'memory' : 'ready';
		} catch {
			// Хранилище нечитаемо целиком: остаёмся на значениях по умолчанию.
			// Падать здесь нельзя — приложение обязано открыться.
			this.status = 'memory';
		}

		this.#scheduleMidnight();
	}

	/** Полный сброс: и в памяти, и на диске. */
	async reset(): Promise<void> {
		await db.clearAllData();

		this.doc = db.createDefaultDocument(this.doc.user.timezone);
		this.foodEntries = [];
		this.planItems = [];
		this.habits = [];
		this.habitCompletions = [];
		this.financeEntries = [];
		this.weightEntries = [];
		this.currentDate = getToday(this.doc.user.timezone);
		this.#followToday = true;

		await db.savePlannerDocument($state.snapshot(this.doc));
	}

	/** Снять таймеры. Вызывать при размонтировании, иначе они переживут HMR. */
	dispose(): void {
		if (this.#midnightTimer !== null) {
			clearTimeout(this.#midnightTimer);
			this.#midnightTimer = null;
		}
	}

	/**
	 * Перевод даты в полночь.
	 *
	 * Одноразовый таймаут, перевзводимый после срабатывания, а не setInterval:
	 * интервал накапливает дрейф и не переживает перевод часов. Фактический
	 * ключ дня перечитывается при срабатывании, поэтому расхождение расчёта
	 * в сутки перехода на летнее время выправляется само.
	 */
	#scheduleMidnight(): void {
		this.dispose();

		const delay = msUntilNextMidnight(new Date(), this.doc.user.timezone);

		this.#midnightTimer = setTimeout(() => {
			if (this.#followToday) {
				this.currentDate = getToday(this.doc.user.timezone);
			}
			this.#scheduleMidnight();
		}, delay);
	}

	/**
	 * Фоновая запись.
	 *
	 * UI не ждёт диск. Ошибка записи не должна разрушать сценарий:
	 * данные уже в памяти, пользователь продолжает работать.
	 */
	#pending = new Set<Promise<unknown>>();

	/**
	 * Слушатели изменений.
	 *
	 * Стор намеренно ничего не знает про синхронизацию: импорт очереди отсюда
	 * замкнул бы модули друг на друга. Подписывается сама очередь.
	 */
	#listeners = new Set<() => void>();

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#notify(): void {
		for (const listener of this.#listeners) {
			try {
				listener();
			} catch {
				// Сломавшийся слушатель не должен рушить запись данных.
			}
		}
	}

	#persist(operation: () => Promise<void>): void {
		this.#notify();
		const task = operation()
			.catch((error) => {
				console.error('[plannerStore] не удалось сохранить изменение', error);
			})
			.finally(() => this.#pending.delete(task));

		this.#pending.add(task);
	}

	/**
	 * Дождаться завершения фоновых записей.
	 *
	 * Цикл, а не один Promise.all: завершившаяся операция может успеть
	 * поставить в очередь следующую, и одного прохода не хватит.
	 */
	async flush(): Promise<void> {
		while (this.#pending.size > 0) {
			await Promise.all([...this.#pending]);
		}
	}

	#saveDoc(): void {
		this.#persist(() => db.savePlannerDocument($state.snapshot(this.doc)));
	}

	/* ───────────────── Пользователь, настройки, дата ───────────────── */

	updateUser(patch: Partial<Omit<PlannerUser, 'createdAt'>>): void {
		this.doc.user = { ...this.doc.user, ...patch, updatedAt: nowIso() };
		this.#saveDoc();

		// Смена пояса сдвигает и границу суток, и текущий день.
		if (patch.timezone) {
			if (this.#followToday) this.currentDate = getToday(patch.timezone);
			this.#scheduleMidnight();
		}
	}

	updateSettings(patch: Partial<PlannerSettings>): void {
		this.doc.settings = { ...this.doc.settings, ...patch };
		// Отметка нужна синхронизации: по ней сервер решает, чья версия
		// настроек свежее. Без неё правки целей молча не доезжали.
		this.doc.settingsUpdatedAt = nowIso();
		this.#saveDoc();
	}

	setDate(date: DateKey): void {
		this.currentDate = date;
		// Ручной выбор дня отключает следование за полуночью: иначе просмотр
		// истории в 23:59 сам собой перескочил бы на новый день.
		this.#followToday = date === getToday(this.doc.user.timezone);
	}

	goToToday(): void {
		this.currentDate = getToday(this.doc.user.timezone);
		this.#followToday = true;
	}

	/* ───────────────── Питание ───────────────── */

	/** Запись целей дня, создаётся по требованию из настроек. */
	#ensureNutrition(date: DateKey): DailyNutritionRecord {
		const existing = this.doc.nutrition[date];
		if (existing) return existing;

		const { settings } = this.doc;
		const timestamp = nowIso();
		const created: DailyNutritionRecord = {
			id: createId(),
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			date,
			calorieGoal: settings.calorieGoal,
			proteinGoal: settings.proteinGoal,
			fatGoal: settings.fatGoal,
			carbsGoal: settings.carbsGoal,
			waterGoalMl: settings.waterGoalMl,
			waterConsumedMl: 0
		};

		this.doc.nutrition[date] = created;
		return created;
	}

	addFoodEntry(input: FoodEntryInput): FoodEntry {
		const timestamp = nowIso();
		const entry: FoodEntry = {
			...input,
			id: createId(),
			date: input.date ?? this.currentDate,
			createdAt: timestamp,
			updatedAt: timestamp
		};

		this.foodEntries.push(entry);
		this.#persist(() => db.saveFoodEntry(entry));
		return entry;
	}

	updateFoodEntry(id: string, patch: Partial<Omit<FoodEntry, 'id' | 'createdAt'>>): void {
		const entry = this.foodEntries.find((item) => item.id === id);
		if (!entry) return;

		Object.assign(entry, patch, { updatedAt: nowIso() });
		this.#persist(() => db.saveFoodEntry($state.snapshot(entry)));
	}

	removeFoodEntry(id: string): void {
		const index = this.foodEntries.findIndex((item) => item.id === id);
		if (index === -1) return;

		this.foodEntries.splice(index, 1);
		this.#persist(() => db.deleteFoodEntry(id));
	}

	/* ───────────────── План на день ───────────────── */

	addPlanItem(input: PlanItemInput): PlanItem {
		const timestamp = nowIso();
		const item: PlanItem = {
			...input,
			id: createId(),
			date: input.date ?? this.currentDate,
			done: input.done ?? false,
			createdAt: timestamp,
			updatedAt: timestamp
		};

		this.planItems.push(item);
		this.#persist(() => db.savePlanItem(item));
		return item;
	}

	updatePlanItem(id: string, patch: Partial<Omit<PlanItem, 'id' | 'createdAt'>>): void {
		const item = this.planItems.find((entry) => entry.id === id);
		if (!item) return;

		Object.assign(item, patch, { updatedAt: nowIso() });
		this.#persist(() => db.savePlanItem($state.snapshot(item)));
	}

	togglePlanItem(id: string): boolean {
		const item = this.planItems.find((entry) => entry.id === id);
		if (!item) return false;

		const next = !item.done;
		this.updatePlanItem(id, { done: next });
		return next;
	}

	removePlanItem(id: string): void {
		const index = this.planItems.findIndex((entry) => entry.id === id);
		if (index === -1) return;

		this.planItems.splice(index, 1);
		this.#persist(() => db.deletePlanItem(id));
	}

	/**
	 * Отметка правки записи дня.
	 *
	 * Без неё изменение цели или выпитой воды не попадёт в пакет
	 * синхронизации: очередь отбирает записи по updatedAt, а не по факту
	 * сохранения документа.
	 */
	#touchDay(record: { updatedAt: string }): void {
		record.updatedAt = nowIso();
	}

	setCalorieGoal(goal: number, date: DateKey = this.currentDate): void {
		if (!Number.isFinite(goal) || goal < 0) return;
		const nutrition = this.#ensureNutrition(date);
		nutrition.calorieGoal = goal;
		this.#touchDay(nutrition);
		this.#saveDoc();
	}

	/**
	 * Цели по макросам на день.
	 *
	 * Отдельный метод, а не три вызова подряд: запись целей дня создаётся
	 * по требованию, и три отдельных вызова означали бы три сохранения
	 * документа ради одного действия пользователя.
	 */
	setMacroGoals(
		goals: { proteinGoal?: number; fatGoal?: number; carbsGoal?: number },
		date: DateKey = this.currentDate
	): void {
		const nutrition = this.#ensureNutrition(date);

		for (const [key, value] of Object.entries(goals)) {
			if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
				nutrition[key as keyof typeof goals] = value;
			}
		}

		this.#touchDay(nutrition);
		this.#saveDoc();
	}

	setWaterGoal(goalMl: number, date: DateKey = this.currentDate): void {
		if (!Number.isFinite(goalMl) || goalMl < 0) return;
		const nutrition = this.#ensureNutrition(date);
		nutrition.waterGoalMl = goalMl;
		this.#touchDay(nutrition);
		this.#saveDoc();
	}

	addWater(ml = 250, date: DateKey = this.currentDate): void {
		if (!Number.isFinite(ml) || ml <= 0) return;
		const nutrition = this.#ensureNutrition(date);
		nutrition.waterConsumedMl += ml;
		this.#touchDay(nutrition);
		this.#saveDoc();
	}

	removeWater(ml = 250, date: DateKey = this.currentDate): void {
		if (!Number.isFinite(ml) || ml <= 0) return;
		const nutrition = this.#ensureNutrition(date);
		// Отрицательный объём выпитого бессмыслен.
		nutrition.waterConsumedMl = Math.max(0, nutrition.waterConsumedMl - ml);
		this.#touchDay(nutrition);
		this.#saveDoc();
	}

	/* ───────────────── Импорт ───────────────── */

	/**
	 * Приём записей из файла выгрузки.
	 *
	 * Побеждает более свежая версия — то же правило, по которому сливает
	 * синхронизация. Иначе восстановление из вчерашнего файла откатывало бы
	 * сегодняшние правки, а человек был бы уверен, что «просто вернул данные».
	 *
	 * Идентификаторы сохраняются: запись, приехавшая из файла, — это та же
	 * запись, а не её копия. С новыми идентификаторами повторный импорт
	 * одного и того же файла удваивал бы весь дневник.
	 */
	importRecords(payload: {
		foodEntries?: unknown[];
		habits?: unknown[];
		habitCompletions?: unknown[];
		financeEntries?: unknown[];
		planItems?: unknown[];
		weightEntries?: unknown[];
		nutrition?: Record<string, unknown>;
		finance?: Record<string, unknown>;
	}): ImportSummary {
		const summary: ImportSummary = { added: 0, updated: 0, skipped: 0 };

		const merge = <T extends { id: string; updatedAt: string }>(
			target: T[],
			incoming: unknown[] | undefined
		): T[] => {
			const accepted: T[] = [];
			if (!incoming) return accepted;

			const byId = new Map(target.map((item) => [item.id, item]));

			for (const raw of incoming) {
				const candidate = raw as Partial<T>;
				if (typeof candidate?.id !== 'string' || typeof candidate.updatedAt !== 'string') {
					summary.skipped += 1;
					continue;
				}

				const existing = byId.get(candidate.id);

				if (existing) {
					if (existing.updatedAt >= candidate.updatedAt) {
						summary.skipped += 1;
						continue;
					}

					Object.assign(existing, candidate);
					accepted.push($state.snapshot(existing) as T);
					summary.updated += 1;
					continue;
				}

				const item = candidate as T;
				target.push(item);
				byId.set(item.id, item);
				accepted.push(item);
				summary.added += 1;
			}

			return accepted;
		};

		const mergeDays = <T extends { date: string; updatedAt: string }>(
			target: Record<string, T>,
			incoming: Record<string, unknown> | undefined
		): void => {
			if (!incoming) return;

			for (const [date, raw] of Object.entries(incoming)) {
				const candidate = raw as Partial<T>;
				if (typeof candidate?.updatedAt !== 'string') {
					summary.skipped += 1;
					continue;
				}

				const existing = target[date];
				if (existing && existing.updatedAt >= candidate.updatedAt) {
					summary.skipped += 1;
					continue;
				}

				target[date] = { ...(candidate as T), date };
				if (existing) summary.updated += 1;
				else summary.added += 1;
			}
		};

		const accepted = {
			foodEntries: merge(this.foodEntries, payload.foodEntries),
			habits: merge(this.habits, payload.habits),
			habitCompletions: merge(this.habitCompletions, payload.habitCompletions),
			financeEntries: merge(this.financeEntries, payload.financeEntries),
			planItems: merge(this.planItems, payload.planItems),
			weightEntries: merge(this.weightEntries, payload.weightEntries)
		};

		mergeDays(this.doc.nutrition, payload.nutrition);
		mergeDays(this.doc.finance, payload.finance);

		this.weightEntries.sort((a, b) => a.date.localeCompare(b.date));

		this.#persist(() => db.saveImportedEntries(accepted));
		this.#saveDoc();

		return summary;
	}

	/* ───────────────── Вес ───────────────── */

	/**
	 * Запись веса за день.
	 *
	 * Одна запись на дату: повторное взвешивание в тот же день заменяет
	 * прежнее значение, а не добавляет второе. Три цифры за сутки отличаются
	 * в основном содержимым желудка — в графике это шум, а не динамика.
	 */
	setWeight(weightKg: number, date: DateKey = this.currentDate, note?: string): WeightEntry | null {
		if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

		const existing = this.weightEntries.find((entry) => entry.date === date);

		if (existing) {
			existing.weightKg = weightKg;
			existing.note = note;
			existing.updatedAt = nowIso();
			const snapshot = $state.snapshot(existing);
			this.#persist(() => db.saveWeightEntry(snapshot));
			return snapshot;
		}

		const timestamp = nowIso();
		const entry: WeightEntry = {
			id: createId(),
			date,
			weightKg,
			note,
			createdAt: timestamp,
			updatedAt: timestamp
		};

		// Порядок по дню: запись задним числом должна встать в график
		// на своё место, а не в конец.
		this.weightEntries.push(entry);
		this.weightEntries.sort((a, b) => a.date.localeCompare(b.date));

		this.#persist(() => db.saveWeightEntry(entry));
		return entry;
	}

	removeWeight(date: DateKey): void {
		const index = this.weightEntries.findIndex((entry) => entry.date === date);
		if (index === -1) return;

		const [removed] = this.weightEntries.splice(index, 1);
		this.#persist(() => db.deleteWeightEntry(removed.id));
	}

	getWeight(date: DateKey): WeightEntry | undefined {
		return this.weightEntries.find((entry) => entry.date === date);
	}

	/* ───────────────── Привычки ───────────────── */

	createHabit(input: HabitInput): Habit {
		const timestamp = nowIso();
		const habit: Habit = {
			id: createId(),
			name: input.name,
			icon: input.icon,
			frequency: input.frequency,
			targetDays: input.targetDays,
			createdAt: timestamp,
			updatedAt: timestamp,
			archived: false
		};

		this.habits.push(habit);
		this.#persist(() => db.saveHabit(habit));
		return habit;
	}

	updateHabit(id: string, patch: Partial<Omit<Habit, 'id' | 'createdAt'>>): void {
		const habit = this.habits.find((item) => item.id === id);
		if (!habit) return;

		Object.assign(habit, patch, { updatedAt: nowIso() });
		this.#persist(() => db.saveHabit($state.snapshot(habit)));
	}

	archiveHabit(id: string): void {
		this.updateHabit(id, { archived: true });
	}

	restoreHabit(id: string): void {
		this.updateHabit(id, { archived: false });
	}

	/**
	 * Удаление привычки вместе с её историей.
	 *
	 * Это единственное место, где отметки удаляются, и только по явному
	 * действию пользователя. Автоматической чистки истории в приложении нет.
	 */
	deleteHabit(id: string): void {
		const index = this.habits.findIndex((item) => item.id === id);
		if (index === -1) return;

		this.habits.splice(index, 1);
		this.#persist(() => db.deleteHabit(id));

		const orphaned = this.habitCompletions.filter((item) => item.habitId === id);
		this.habitCompletions = this.habitCompletions.filter((item) => item.habitId !== id);
		for (const completion of orphaned) {
			this.#persist(() => db.deleteHabitCompletion(completion.id));
		}
	}

	getHabit(id: string): Habit | undefined {
		return this.habits.find((item) => item.id === id);
	}

	isHabitCompleted(habitId: string, date: DateKey = this.currentDate): boolean {
		return (
			this.habitCompletions.find((item) => item.habitId === habitId && item.date === date)
				?.completed ?? false
		);
	}

	#setCompletion(habitId: string, date: DateKey, completed: boolean): void {
		const existing = this.habitCompletions.find(
			(item) => item.habitId === habitId && item.date === date
		);

		if (existing) {
			if (existing.completed === completed) return;
			existing.completed = completed;
			existing.updatedAt = nowIso();
			this.#persist(() => db.saveHabitCompletion($state.snapshot(existing)));
			return;
		}

		const timestamp = nowIso();
		const completion: HabitCompletion = {
			id: createId(),
			habitId,
			date,
			completed,
			createdAt: timestamp,
			updatedAt: timestamp
		};

		this.habitCompletions.push(completion);
		this.#persist(() => db.saveHabitCompletion(completion));
	}

	completeHabit(habitId: string, date: DateKey = this.currentDate): void {
		this.#setCompletion(habitId, date, true);
	}

	uncompleteHabit(habitId: string, date: DateKey = this.currentDate): void {
		this.#setCompletion(habitId, date, false);
	}

	toggleHabit(habitId: string, date: DateKey = this.currentDate): boolean {
		const next = !this.isHabitCompleted(habitId, date);
		this.#setCompletion(habitId, date, next);
		return next;
	}

	/* ───────────────── Финансы ───────────────── */

	#ensureFinance(date: DateKey): DailyFinanceRecord {
		const existing = this.doc.finance[date];
		if (existing) return existing;

		const timestamp = nowIso();
		const created: DailyFinanceRecord = {
			id: createId(),
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			date,
			budget: this.doc.settings.dailyBudget
		};

		this.doc.finance[date] = created;
		return created;
	}

	addFinanceEntry(input: FinanceEntryInput): FinanceEntry {
		const timestamp = nowIso();
		const entry: FinanceEntry = {
			...input,
			id: createId(),
			date: input.date ?? this.currentDate,
			createdAt: timestamp,
			updatedAt: timestamp
		};

		this.financeEntries.push(entry);
		this.#persist(() => db.saveFinanceEntry(entry));
		return entry;
	}

	updateFinanceEntry(id: string, patch: Partial<Omit<FinanceEntry, 'id' | 'createdAt'>>): void {
		const entry = this.financeEntries.find((item) => item.id === id);
		if (!entry) return;

		Object.assign(entry, patch, { updatedAt: nowIso() });
		this.#persist(() => db.saveFinanceEntry($state.snapshot(entry)));
	}

	deleteFinanceEntry(id: string): void {
		const index = this.financeEntries.findIndex((item) => item.id === id);
		if (index === -1) return;

		this.financeEntries.splice(index, 1);
		this.#persist(() => db.deleteFinanceEntry(id));
	}

	setDailyBudget(budget: number, date: DateKey = this.currentDate): void {
		if (!Number.isFinite(budget) || budget < 0) return;
		const finance = this.#ensureFinance(date);
		finance.budget = budget;
		this.#touchDay(finance);
		this.#saveDoc();
	}

	/* ───────────────── Производные значения ───────────────── */

	/**
	 * Цели текущего дня. Если записи ещё нет, отдаём значения из настроек,
	 * НЕ создавая её: чтение не должно писать в состояние.
	 */
	todayNutrition = $derived.by<DailyNutrition>(() => {
		const existing = this.doc.nutrition[this.currentDate];
		if (existing) return existing;

		const { settings } = this.doc;
		return {
			date: this.currentDate,
			calorieGoal: settings.calorieGoal,
			proteinGoal: settings.proteinGoal,
			fatGoal: settings.fatGoal,
			carbsGoal: settings.carbsGoal,
			waterGoalMl: settings.waterGoalMl,
			waterConsumedMl: 0
		};
	});

	todayFoods = $derived(this.foodEntries.filter((entry) => entry.date === this.currentDate));

	caloriesConsumed = $derived(sum(this.todayFoods.map((entry) => entry.calories)));
	proteinConsumed = $derived(sum(this.todayFoods.map((entry) => entry.protein)));
	fatConsumed = $derived(sum(this.todayFoods.map((entry) => entry.fat)));
	carbsConsumed = $derived(sum(this.todayFoods.map((entry) => entry.carbs)));

	/** Может быть отрицательным при переборе — это осмысленная величина. */
	caloriesRemaining = $derived(this.todayNutrition.calorieGoal - this.caloriesConsumed);
	isOverCalorieGoal = $derived(this.caloriesConsumed > this.todayNutrition.calorieGoal);

	// Доли выражены в 0…1, а не в процентах: ровно это принимают ProgressRing
	// и полоски макросов. Процент — это умножение на 100 на месте вызова,
	// а второе производное поле было бы вторым источником одной и той же истины.
	calorieProgress = $derived(ratio(this.caloriesConsumed, this.todayNutrition.calorieGoal));
	proteinProgress = $derived(ratio(this.proteinConsumed, this.todayNutrition.proteinGoal));
	fatProgress = $derived(ratio(this.fatConsumed, this.todayNutrition.fatGoal));
	carbsProgress = $derived(ratio(this.carbsConsumed, this.todayNutrition.carbsGoal));
	waterProgress = $derived(
		ratio(this.todayNutrition.waterConsumedMl, this.todayNutrition.waterGoalMl)
	);

	/**
	 * План выбранного дня, отсортированный по времени.
	 *
	 * Пункты без времени уходят в конец: «когда-нибудь сегодня» не должно
	 * разрывать последовательность дел, у которых час назначен.
	 */
	todayPlan = $derived(
		this.planItems
			.filter((item) => item.date === this.currentDate)
			.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
	);

	donePlanItems = $derived(this.todayPlan.filter((item) => item.done));

	planProgress = $derived(ratio(this.donePlanItems.length, this.todayPlan.length));

	todayHabits = $derived(scheduledHabits(this.habits, this.currentDate));

	completedHabits = $derived(
		this.todayHabits.filter((habit) => this.isHabitCompleted(habit.id, this.currentDate))
	);

	habitCompletionProgress = $derived(ratio(this.completedHabits.length, this.todayHabits.length));

	todayFinance = $derived.by<DailyFinance>(
		() =>
			this.doc.finance[this.currentDate] ?? {
				date: this.currentDate,
				budget: this.doc.settings.dailyBudget
			}
	);

	#todayEntries = $derived(this.financeEntries.filter((entry) => entry.date === this.currentDate));

	todayExpenses = $derived(this.#todayEntries.filter((entry) => entry.type === 'expense'));
	todayIncome = $derived(this.#todayEntries.filter((entry) => entry.type === 'income'));

	dailySpent = $derived(sum(this.todayExpenses.map((entry) => entry.amount)));
	dailyIncome = $derived(sum(this.todayIncome.map((entry) => entry.amount)));
	dailyBalance = $derived(this.dailyIncome - this.dailySpent);

	/** Отрицательное значение означает превышение бюджета. */
	dailyBudgetRemaining = $derived(this.todayFinance.budget - this.dailySpent);
	dailyBudgetProgress = $derived(ratio(this.dailySpent, this.todayFinance.budget));
	isOverBudget = $derived(this.dailySpent > this.todayFinance.budget);

	expensesByCategory = $derived.by<Record<FinanceCategory, number>>(() => {
		const totals = {} as Record<FinanceCategory, number>;
		for (const entry of this.todayExpenses) {
			totals[entry.category] = (totals[entry.category] ?? 0) + entry.amount;
		}
		return totals;
	});

	/**
	 * Последнее взвешивание.
	 *
	 * Именно последнее по дате, а не по времени записи: вес, добавленный
	 * задним числом за прошлую неделю, не делает прошлую неделю «текущей».
	 */
	latestWeight = $derived.by<WeightEntry | null>(() => {
		const entries = this.weightEntries;
		return entries.length > 0 ? entries[entries.length - 1] : null;
	});

	/** Подряд идущие дни, где закрыты все запланированные привычки. */
	currentStreak = $derived(
		calculateDayStreak(this.habits, this.habitCompletions, this.currentDate)
	);

	/** Лучший результат за всю историю. */
	longestStreak = $derived(
		calculateLongestDayStreak(this.habits, this.habitCompletions, this.currentDate)
	);
}

export const plannerStore = new PlannerStore();

/** Тип экземпляра стора — для модулей, принимающих его параметром. */
export type PlannerStoreLike = PlannerStore;
