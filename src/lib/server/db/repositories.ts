import { and, eq, gt, lt, sql, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from './client';
import {
	dailyFinance,
	dailyNutrition,
	financeEntries,
	foodEntries,
	habitCompletions,
	habits,
	pendingScans,
	planItems,
	plannerState,
	users,
	type UserRow
} from './schema';

/** Минимум, который обязана нести любая синхронизируемая запись. */
export interface SyncRow {
	id: string;
	createdAt: string;
	updatedAt: string;
	deletedAt?: string | null;
}

export interface SyncRepository<T extends SyncRow> {
	readonly name: string;
	/** Записи, изменённые строго позже указанной отметки. null — отдать всё. */
	pullSince(userId: string, since: string | null): Promise<T[]>;
	/** Приём пачки. Возвращает число реально применённых записей. */
	upsertMany(userId: string, rows: T[]): Promise<number>;
}

/**
 * Универсальная реализация синхронизируемой таблицы.
 *
 * Все шесть таблиц отличаются только набором полезных полей, а правила
 * выборки и слияния у них одни. Шесть почти одинаковых классов разъехались бы
 * при первой же правке логики конфликтов.
 */
function createSyncRepository<T extends SyncRow>(
	db: Db,
	name: string,
	table: SQLiteTable & {
		id: never;
		userId: never;
		updatedAt: never;
	},
	options: {
		/**
		 * Слияние по паре «пользователь + день», а не по идентификатору.
		 *
		 * Нужно таблицам, где день существует в единственном экземпляре:
		 * цели и бюджет дня. Два устройства, создавшие запись одного дня
		 * офлайн, приходят с разными случайными идентификаторами, и слияние
		 * по id упёрлось бы в уникальный индекс (user_id, date) — то есть
		 * уронило бы весь пакет вместо того, чтобы соединить две правки.
		 */
		conflictOnUserDate?: boolean;
	} = {}
): SyncRepository<T> {
	// Типы Drizzle не выражают «любая таблица с этими колонками», поэтому
	// доступ к колонкам идёт через приведение. Границы таблиц заданы
	// вызывающим кодом ниже и не приходят снаружи.
	const columns = table as unknown as {
		id: never;
		userId: never;
		updatedAt: never;
		date: never;
	};
	const anyTable = table as never;

	const conflictTarget = options.conflictOnUserDate ? [columns.userId, columns.date] : columns.id;

	return {
		name,

		async pullSince(userId: string, since: string | null): Promise<T[]> {
			// Фильтр по userId стоит первым и обязателен: без него один
			// пользователь вычитает чужие записи.
			const where: SQL | undefined = since
				? and(eq(columns.userId, userId), gt(columns.updatedAt, since))
				: eq(columns.userId, userId);

			return (await db.select().from(anyTable).where(where)) as T[];
		},

		async upsertMany(userId: string, rows: T[]): Promise<number> {
			if (rows.length === 0) return 0;

			let applied = 0;

			// Одна транзакция на пачку: иначе полусинхронизированное состояние
			// останется в базе, если соединение оборвётся посередине.
			await db.transaction(async (tx) => {
				for (const row of rows) {
					// userId всегда из сессии. Значение из тела запроса
					// игнорируется намеренно: иначе клиент подменит его
					// и запишет данные в чужой аккаунт.
					const values: Record<string, unknown> = {
						...(row as unknown as Record<string, unknown>),
						userId
					};

					// id и createdAt при слиянии не трогаем: первый — ключ конфликта,
					// второй фиксирует момент создания и не должен переписываться
					// пришедшей позже копией.
					const updatable: Record<string, unknown> = { ...values };
					delete updatable.id;
					delete updatable.createdAt;

					const result = await tx
						.insert(anyTable)
						.values(values as never)
						.onConflictDoUpdate({
							target: conflictTarget,
							set: updatable as never,
							// Последняя запись побеждает: обновляем только если
							// пришедшая версия новее сохранённой. Без этого условия
							// отставший клиент откатывал бы свежие правки.
							setWhere: sql`excluded.updated_at > ${columns.updatedAt}`
						});

					if (result.rowsAffected > 0) applied += 1;
				}
			});

			return applied;
		}
	};
}

export interface UserRepository {
	findByTelegramId(telegramUserId: string): Promise<UserRow | null>;
	upsertFromTelegram(input: {
		id: string;
		telegramUserId: string;
		username?: string;
		firstName?: string;
		timezone?: string;
		now: string;
	}): Promise<UserRow>;
	listAll(): Promise<UserRow[]>;
}

export interface PlannerRepository {
	get(
		userId: string
	): Promise<{ schemaVersion: number; settings: unknown; updatedAt: string } | null>;
	save(input: {
		userId: string;
		schemaVersion: number;
		settings: unknown;
		updatedAt: string;
	}): Promise<void>;
}

/**
 * Разборы, ожидающие подтверждения в чате с ботом.
 *
 * Хранилище одноразовое: запись выдаётся ровно один раз и тут же удаляется,
 * поэтому повторное нажатие кнопки не добавит блюдо в дневник дважды.
 */
export interface PendingScanRepository {
	save(input: { id: string; userId: string; payload: unknown; now: string }): Promise<void>;
	/** Забрать и удалить. Чужую запись не отдаёт: userId проверяется в запросе. */
	take(id: string, userId: string): Promise<unknown | null>;
	/** Убрать протухшие. Вызывается попутно, отдельного планировщика здесь нет. */
	purgeOlderThan(threshold: string): Promise<void>;
}

export interface Repositories {
	users: UserRepository;
	planner: PlannerRepository;
	food: SyncRepository<SyncRow>;
	habits: SyncRepository<SyncRow>;
	completions: SyncRepository<SyncRow>;
	finance: SyncRepository<SyncRow>;
	nutritionDays: SyncRepository<SyncRow>;
	financeDays: SyncRepository<SyncRow>;
	plan: SyncRepository<SyncRow>;
	pendingScans: PendingScanRepository;
}

export function createRepositories(db: Db): Repositories {
	const userRepository: UserRepository = {
		async findByTelegramId(telegramUserId) {
			const [row] = await db
				.select()
				.from(users)
				.where(eq(users.telegramUserId, telegramUserId))
				.limit(1);
			return row ?? null;
		},

		async upsertFromTelegram(input) {
			const existing = await userRepository.findByTelegramId(input.telegramUserId);

			if (existing) {
				// Имя и ник в Telegram меняются — подтягиваем при каждом входе.
				// Часовой пояс не трогаем: его задаёт приложение, а не Telegram.
				await db
					.update(users)
					.set({
						username: input.username ?? existing.username,
						firstName: input.firstName ?? existing.firstName,
						updatedAt: input.now
					})
					.where(eq(users.id, existing.id));

				return { ...existing, username: input.username ?? existing.username, updatedAt: input.now };
			}

			const row: UserRow = {
				id: input.id,
				telegramUserId: input.telegramUserId,
				username: input.username ?? null,
				firstName: input.firstName ?? null,
				timezone: input.timezone ?? 'UTC',
				createdAt: input.now,
				updatedAt: input.now
			};

			await db.insert(users).values(row);
			return row;
		},

		async listAll() {
			return db.select().from(users);
		}
	};

	const plannerRepository: PlannerRepository = {
		async get(userId) {
			const [row] = await db
				.select()
				.from(plannerState)
				.where(eq(plannerState.userId, userId))
				.limit(1);

			return row
				? { schemaVersion: row.schemaVersion, settings: row.settings, updatedAt: row.updatedAt }
				: null;
		},

		async save({ userId, schemaVersion, settings, updatedAt }) {
			await db
				.insert(plannerState)
				.values({ userId, schemaVersion, settings, updatedAt })
				.onConflictDoUpdate({
					target: plannerState.userId,
					set: { schemaVersion, settings, updatedAt },
					setWhere: sql`excluded.updated_at > ${plannerState.updatedAt}`
				});
		}
	};

	const pendingScanRepository: PendingScanRepository = {
		async save({ id, userId, payload, now }) {
			await db.insert(pendingScans).values({ id, userId, payload, createdAt: now });
		},

		async take(id, userId) {
			const [row] = await db
				.select()
				.from(pendingScans)
				.where(and(eq(pendingScans.id, id), eq(pendingScans.userId, userId)))
				.limit(1);

			if (!row) return null;

			await db.delete(pendingScans).where(eq(pendingScans.id, id));
			return row.payload;
		},

		async purgeOlderThan(threshold) {
			await db.delete(pendingScans).where(lt(pendingScans.createdAt, threshold));
		}
	};

	return {
		users: userRepository,
		planner: plannerRepository,
		food: createSyncRepository(db, 'foodEntries', foodEntries as never),
		habits: createSyncRepository(db, 'habits', habits as never),
		completions: createSyncRepository(db, 'habitCompletions', habitCompletions as never),
		finance: createSyncRepository(db, 'financeEntries', financeEntries as never),
		nutritionDays: createSyncRepository(db, 'dailyNutrition', dailyNutrition as never, {
			conflictOnUserDate: true
		}),
		financeDays: createSyncRepository(db, 'dailyFinance', dailyFinance as never, {
			conflictOnUserDate: true
		}),
		plan: createSyncRepository(db, 'planItems', planItems as never),
		pendingScans: pendingScanRepository
	};
}
