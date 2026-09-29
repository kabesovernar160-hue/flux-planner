import {
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

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
		updatedAt: text('updated_at').notNull(),
		/**
		 * Откуда человек пришёл впервые: метка рекламы, referral или direct.
		 * Пишется один раз и не перезаписывается — иначе вторая ссылка
		 * присвоила бы себе человека, которого привела первая.
		 */
		source: text('source'),
		/** Первое открытие Mini App. Пусто у тех, кто нажал /start и не дошёл до приложения. */
		appOpenedAt: text('app_opened_at'),
		/** Первая запись любого вида. Ставит триггер в базе — см. миграцию 0009. */
		firstRecordAt: text('first_record_at')
	},
	(table) => [uniqueIndex('users_telegram_id_idx').on(table.telegramUserId)]
);

/**
 * Дни, в которые человек открывал приложение.
 *
 * Одна строка на пользователя и день (UTC): из неё считается возврат на
 * следующий день и через неделю. Хранится день, а не каждый вход — таблица
 * растёт не быстрее числа активных пользователей на число дней.
 */
export const userActivity = sqliteTable(
	'user_activity',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		date: text('date').notNull()
	},
	(table) => [primaryKey({ columns: [table.userId, table.date] })]
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
 * Ключи быстрой записи.
 *
 * Нужны, чтобы записать дело или трату, не открывая Telegram: «Быстрая
 * команда» на телефоне отправляет строку напрямую в приложение. Подпись
 * Telegram там взять неоткуда — Mini App не запущен, — поэтому у человека
 * есть личный ключ.
 *
 * Хранится только хеш: утёкшая база не должна давать доступ к чужим
 * дневникам. Ключ односторонний — им можно записать, но нельзя прочитать,
 * и отзывается он одной кнопкой.
 */
export const captureTokens = sqliteTable(
	'capture_tokens',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** SHA-256 от самого ключа, в шестнадцатеричном виде. */
		tokenHash: text('token_hash').notNull(),
		createdAt: text('created_at').notNull(),
		/** Когда ключом воспользовались в последний раз: видно, живёт ли он. */
		lastUsedAt: text('last_used_at'),
		/** Отозван — ключ больше не работает, но запись о нём остаётся. */
		revokedAt: text('revoked_at')
	},
	(table) => [
		uniqueIndex('capture_token_hash_idx').on(table.tokenHash),
		index('capture_token_user_idx').on(table.userId)
	]
);

/**
 * Одноразовые коды входа на устройстве без Telegram.
 *
 * Бот выдаёт код по кнопке «📱 Приложение на телефон», приложение в браузере
 * меняет его на сессию устройства. Живёт десять минут, срабатывает один раз,
 * в базе — только хеш.
 */
export const loginTokens = sqliteTable(
	'login_tokens',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** SHA-256 от нормализованного кода, в шестнадцатеричном виде. */
		tokenHash: text('token_hash').notNull(),
		createdAt: text('created_at').notNull(),
		expiresAt: text('expires_at').notNull(),
		/** Код обменян на сессию — второй раз не сработает. */
		usedAt: text('used_at')
	},
	(table) => [
		uniqueIndex('login_token_hash_idx').on(table.tokenHash),
		index('login_token_user_idx').on(table.userId)
	]
);

/**
 * Сессии устройств: приложение на главном экране, браузер.
 *
 * Кука несёт «идентификатор.секрет», в базе — хеш секрета. Секрет
 * периодически меняется; прежний хеш принимается ещё несколько минут,
 * чтобы запросы, ушедшие со старой кукой, не выкинули человека.
 */
export const deviceSessions = sqliteTable(
	'device_sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		secretHash: text('secret_hash').notNull(),
		previousSecretHash: text('previous_secret_hash'),
		/** «iPhone · Safari» — чтобы в списке устройств было что узнать. */
		label: text('label').notNull(),
		createdAt: text('created_at').notNull(),
		rotatedAt: text('rotated_at').notNull(),
		lastSeenAt: text('last_seen_at').notNull(),
		expiresAt: text('expires_at').notNull(),
		revokedAt: text('revoked_at')
	},
	(table) => [index('device_session_user_idx').on(table.userId)]
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

/**
 * Реферальный код пользователя.
 *
 * Выдаётся при первом открытии экрана приглашения, а не при регистрации:
 * большинству кодов иначе суждено было бы пролежать без дела.
 */
export const referralCodes = sqliteTable(
	'referral_codes',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => users.id, { onDelete: 'cascade' }),
		code: text('code').notNull(),
		createdAt: text('created_at').notNull()
	},
	(table) => [uniqueIndex('referral_codes_code_idx').on(table.code)]
);

/**
 * Приглашение.
 *
 * Создаётся в статусе pending, когда новый пользователь впервые входит
 * по чужой ссылке, и становится qualified после его первой записи.
 * Уникальность по приглашённому — и по строке, и по ключу его Telegram —
 * не даёт засчитать одного человека дважды.
 */
export const referrals = sqliteTable(
	'referrals',
	{
		id: text('id').primaryKey(),
		inviterId: text('inviter_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		inviteeId: text('invitee_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** HMAC от telegram id приглашённого: переживает обезличивание аккаунта. */
		inviteeKey: text('invitee_key').notNull(),
		status: text('status').notNull(),
		/** Сколько дней Pro получил приглашённый. */
		inviteeDays: integer('invitee_days').notNull().default(0),
		/** Сколько дней Pro получил пригласивший: меньше награды, когда упёрлись в лимит. */
		inviterDays: integer('inviter_days').notNull().default(0),
		createdAt: text('created_at').notNull(),
		qualifiedAt: text('qualified_at')
	},
	(table) => [
		uniqueIndex('referrals_invitee_idx').on(table.inviteeId),
		uniqueIndex('referrals_invitee_key_idx').on(table.inviteeKey),
		index('referrals_inviter_idx').on(table.inviterId, table.status)
	]
);

/**
 * Напоминания новичкам, которые так и не сделали первую запись.
 *
 * Строка на человека, а не на сообщение: напоминаний ровно два за всю
 * жизнь аккаунта, и отметка каждого — отдельная колонка. Заводится лениво,
 * при первой попытке отправки, поэтому у большинства пользователей её нет.
 */
export const activationNudges = sqliteTable('activation_nudges', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** Первое напоминание: через час после знакомства с ботом. */
	firstSentAt: text('first_sent_at'),
	/** Второе и последнее: на третий день. */
	secondSentAt: text('second_sent_at'),
	/** Telegram ответил 403 — бот заблокирован, больше не пишем. */
	blockedAt: text('blocked_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export type UserRow = typeof users.$inferSelect;
export type FoodEntryRow = typeof foodEntries.$inferSelect;
export type HabitRow = typeof habits.$inferSelect;
export type HabitCompletionRow = typeof habitCompletions.$inferSelect;
export type FinanceEntryRow = typeof financeEntries.$inferSelect;
export type WeightEntryRow = typeof weightEntries.$inferSelect;
export type CaptureTokenRow = typeof captureTokens.$inferSelect;
export type LoginTokenRow = typeof loginTokens.$inferSelect;
export type DeviceSessionRow = typeof deviceSessions.$inferSelect;
export type DailyNutritionRow = typeof dailyNutrition.$inferSelect;
export type DailyFinanceRow = typeof dailyFinance.$inferSelect;
export type PlanItemRow = typeof planItems.$inferSelect;
export type PendingScanRow = typeof pendingScans.$inferSelect;
export type ReferralRow = typeof referrals.$inferSelect;
export type RateLimitRow = typeof rateLimits.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type UserActivityRow = typeof userActivity.$inferSelect;
