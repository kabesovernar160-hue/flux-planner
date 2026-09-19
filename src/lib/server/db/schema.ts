import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Схема серверной базы.
 *
 * Отметки времени хранятся строками в формате UTC ISO 8601, а не числами:
 * разрешение конфликтов синхронизации сравнивает их лексикографически,
 * и для ISO это эквивалентно сравнению моментов. Даты дня — YYYY-MM-DD,
 * тот же ключ, что и на клиенте.
 *
 * Каждая пользовательская запись несёт user_id. Это не денормализация ради
 * удобства, а граница безопасности: любой запрос обязан фильтровать по нему,
 * иначе один пользователь получит данные другого.
 */

export const users = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(),
		telegramUserId: text('telegram_user_id').notNull(),
		username: text('username'),
		firstName: text('first_name'),
		timezone: text('timezone').notNull().default('UTC'),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull()
	},
	(table) => [uniqueIndex('users_telegram_id_idx').on(table.telegramUserId)]
);

/** Singleton-документ пользователя: настройки и версия схемы. */
export const plannerState = sqliteTable('planner_state', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	schemaVersion: integer('schema_version').notNull(),
	settings: text('settings', { mode: 'json' }).notNull(),
	updatedAt: text('updated_at').notNull()
});

/**
 * Общие поля синхронизируемой записи.
 *
 * deletedAt — надгробие: удалённая запись не исчезает, а помечается.
 * Без этого удаление на одном устройстве было бы неотличимо от
 * «этой записи тут ещё нет», и второе устройство вернуло бы её обратно.
 */
const syncColumns = {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	deletedAt: text('deleted_at')
};

export const foodEntries = sqliteTable(
	'food_entries',
	{
		...syncColumns,
		date: text('date').notNull(),
		name: text('name').notNull(),
		grams: real('grams'),
		calories: real('calories').notNull(),
		protein: real('protein').notNull(),
		fat: real('fat').notNull(),
		carbs: real('carbs').notNull(),
		source: text('source').notNull(),
		/** Приём пищи. Пусто у записей, созданных до его появления. */
		meal: text('meal')
	},
	(table) => [
		index('food_user_updated_idx').on(table.userId, table.updatedAt),
		index('food_user_date_idx').on(table.userId, table.date)
	]
);

export const habits = sqliteTable(
	'habits',
	{
		...syncColumns,
		name: text('name').notNull(),
		icon: text('icon').notNull(),
		frequency: text('frequency').notNull(),
		/** JSON-массив дней недели. Актуален только для frequency = custom. */
		targetDays: text('target_days', { mode: 'json' }),
		archived: integer('archived', { mode: 'boolean' }).notNull().default(false)
	},
	(table) => [index('habits_user_updated_idx').on(table.userId, table.updatedAt)]
);

export const habitCompletions = sqliteTable(
	'habit_completions',
	{
		...syncColumns,
		habitId: text('habit_id').notNull(),
		date: text('date').notNull(),
		completed: integer('completed', { mode: 'boolean' }).notNull()
	},
	(table) => [
		index('completions_user_updated_idx').on(table.userId, table.updatedAt),
		// Логический ключ отметки — привычка плюс день. Индекс не уникальный
		// намеренно: дубль, приехавший с другого устройства, схлопывает синк,
		// а не отвергает база с ошибкой посреди пакета.
		index('completions_habit_date_idx').on(table.userId, table.habitId, table.date)
	]
);

export const financeEntries = sqliteTable(
	'finance_entries',
	{
		...syncColumns,
		date: text('date').notNull(),
		type: text('type').notNull(),
		amount: real('amount').notNull(),
		category: text('category').notNull(),
		note: text('note')
	},
	(table) => [
		index('finance_user_updated_idx').on(table.userId, table.updatedAt),
		index('finance_user_date_idx').on(table.userId, table.date)
	]
);

/**
 * План на день: разовые цели вроде «ужин в 19:00».
 *
 * Отдельно от привычек: у привычки расписание и серии, у пункта плана —
 * конкретный день и, возможно, час. Общая таблица испортила бы обе сущности.
 */
export const planItems = sqliteTable(
	'plan_items',
	{
		...syncColumns,
		date: text('date').notNull(),
		title: text('title').notNull(),
		time: text('time'),
		kind: text('kind').notNull(),
		done: integer('done', { mode: 'boolean' }).notNull().default(false),
		note: text('note')
	},
	(table) => [
		index('plan_user_updated_idx').on(table.userId, table.updatedAt),
		index('plan_user_date_idx').on(table.userId, table.date)
	]
);

/**
 * Дневник веса.
 *
 * Одна запись на день, как и в приложении: уникальный индекс по паре
 * «пользователь + день» не даёт двум устройствам развести один день
 * на две строки.
 */
export const weightEntries = sqliteTable(
	'weight_entries',
	{
		...syncColumns,
		date: text('date').notNull(),
		weightKg: real('weight_kg').notNull(),
		note: text('note')
	},
	(table) => [
		index('weight_user_updated_idx').on(table.userId, table.updatedAt),
		uniqueIndex('weight_user_date_idx').on(table.userId, table.date)
	]
);

export const dailyNutrition = sqliteTable(
	'daily_nutrition',
	{
		...syncColumns,
		date: text('date').notNull(),
		calorieGoal: real('calorie_goal').notNull(),
		proteinGoal: real('protein_goal').notNull(),
		fatGoal: real('fat_goal').notNull(),
		carbsGoal: real('carbs_goal').notNull(),
		waterGoalMl: real('water_goal_ml').notNull(),
		waterConsumedMl: real('water_consumed_ml').notNull()
	},
	(table) => [
		index('nutrition_user_updated_idx').on(table.userId, table.updatedAt),
		uniqueIndex('nutrition_user_date_idx').on(table.userId, table.date)
	]
);

export const dailyFinance = sqliteTable(
	'daily_finance',
	{
		...syncColumns,
		date: text('date').notNull(),
		budget: real('budget').notNull()
	},
	(table) => [
		index('finance_day_user_updated_idx').on(table.userId, table.updatedAt),
		uniqueIndex('finance_day_user_date_idx').on(table.userId, table.date)
	]
);

/**
 * Результат распознавания, ожидающий подтверждения в чате.
 *
 * Нужен потому, что в переписке с ботом нет экрана правки: пользователь
 * присылает фото, видит разбор и нажимает «Записать». Между этими двумя
 * событиями результат где-то должен лежать, а callback_data у Telegram
 * ограничен 64 байтами и весь разбор в него не помещается.
 *
 * Таблица служебная: в синхронизацию не входит, надгробий не имеет,
 * записи удаляются сразу после подтверждения и протухают по времени.
 */
export const pendingScans = sqliteTable(
	'pending_scans',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** FoodScanResult целиком, в том виде, в каком его подтвердит человек. */
		payload: text('payload', { mode: 'json' }).notNull(),
		createdAt: text('created_at').notNull()
	},
	(table) => [index('pending_scans_user_idx').on(table.userId, table.createdAt)]
);

/**
 * Счётчики частоты запросов.
 *
 * Служебная таблица: в синхронизацию не входит, пользователю не принадлежит,
 * живёт ровно одно окно. Ключ — строка вида «analyze:user:<id>», чтобы
 * разные пределы не смешивались.
 */
export const rateLimits = sqliteTable(
	'rate_limits',
	{
		key: text('key').primaryKey(),
		count: integer('count').notNull(),
		/** Момент окончания окна в миллисекундах. */
		resetAt: integer('reset_at').notNull()
	},
	(table) => [index('rate_limits_reset_idx').on(table.resetAt)]
);

/**
 * Подписка пользователя.
 *
 * Отдельно от users: у подписки своя жизнь — продления, отмена, возврат, —
 * и переписывать её вместе с именем из Telegram при каждом входе было бы
 * ошибкой. Одна строка на пользователя: активная подписка всегда одна.
 */
export const subscriptions = sqliteTable(
	'subscriptions',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => users.id, { onDelete: 'cascade' }),
		plan: text('plan').notNull(),
		status: text('status').notNull(),
		/** Конец оплаченного периода, ISO. Пусто у бессрочного бесплатного плана. */
		expiresAt: text('expires_at'),
		/** Идентификатор платежа Telegram: по нему делается возврат. */
		chargeId: text('charge_id'),
		/** Идентификатор автопродлеваемой подписки Telegram Stars. */
		subscriptionId: text('subscription_id'),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull()
	},
	(table) => [index('subscriptions_expires_idx').on(table.expiresAt)]
);

/**
 * Журнал платежей.
 *
 * Нужен для возвратов, разбора спорных списаний и простого ответа на вопрос
 * «за что списали». Записи отсюда не удаляются даже при отмене подписки:
 * финансовая история должна оставаться полной.
 */
export const payments = sqliteTable(
	'payments',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		chargeId: text('charge_id').notNull(),
		/** Сумма в звёздах Telegram. */
		stars: integer('stars').notNull(),
		payload: text('payload').notNull(),
		status: text('status').notNull(),
		createdAt: text('created_at').notNull()
	},
	(table) => [
		uniqueIndex('payments_charge_idx').on(table.chargeId),
		index('payments_user_idx').on(table.userId, table.createdAt)
	]
);

export type UserRow = typeof users.$inferSelect;
export type FoodEntryRow = typeof foodEntries.$inferSelect;
export type HabitRow = typeof habits.$inferSelect;
export type HabitCompletionRow = typeof habitCompletions.$inferSelect;
export type FinanceEntryRow = typeof financeEntries.$inferSelect;
export type WeightEntryRow = typeof weightEntries.$inferSelect;
export type DailyNutritionRow = typeof dailyNutrition.$inferSelect;
export type DailyFinanceRow = typeof dailyFinance.$inferSelect;
export type PlanItemRow = typeof planItems.$inferSelect;
export type PendingScanRow = typeof pendingScans.$inferSelect;
export type RateLimitRow = typeof rateLimits.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
