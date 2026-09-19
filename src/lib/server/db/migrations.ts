/**
 * Миграции схемы.
 *
 * Раньше таблицы создавались при каждом старте одним куском SQL. Для одного
 * файла на ноутбуке это работало, но для продукта не годится: нет истории
 * изменений, нет способа понять, какая схема сейчас на проде, и любое
 * изменение колонки пришлось бы делать руками по живой базе.
 *
 * Здесь каждый шаг имеет имя и применяется ровно один раз — отметки хранятся
 * в самой базе. Порядок шагов фиксирован и менять его нельзя: на уже
 * развёрнутой базе это разъедет состояние.
 *
 * Первый шаг намеренно написан через IF NOT EXISTS: базы, созданные прежним
 * способом, должны подхватиться без потери данных.
 */

export interface Migration {
	name: string;
	statements: string[];
}

export const MIGRATIONS: Migration[] = [
	{
		name: '0001_initial',
		statements: [
			`CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY,
				telegram_user_id TEXT NOT NULL,
				username TEXT,
				first_name TEXT,
				timezone TEXT NOT NULL DEFAULT 'UTC',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_idx ON users (telegram_user_id)`,

			`CREATE TABLE IF NOT EXISTS planner_state (
				user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
				schema_version INTEGER NOT NULL,
				settings TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,

			`CREATE TABLE IF NOT EXISTS food_entries (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				date TEXT NOT NULL,
				name TEXT NOT NULL,
				grams REAL,
				calories REAL NOT NULL,
				protein REAL NOT NULL,
				fat REAL NOT NULL,
				carbs REAL NOT NULL,
				source TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS food_user_updated_idx ON food_entries (user_id, updated_at)`,
			`CREATE INDEX IF NOT EXISTS food_user_date_idx ON food_entries (user_id, date)`,

			`CREATE TABLE IF NOT EXISTS habits (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				name TEXT NOT NULL,
				icon TEXT NOT NULL,
				frequency TEXT NOT NULL,
				target_days TEXT,
				archived INTEGER NOT NULL DEFAULT 0
			)`,
			`CREATE INDEX IF NOT EXISTS habits_user_updated_idx ON habits (user_id, updated_at)`,

			`CREATE TABLE IF NOT EXISTS habit_completions (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				habit_id TEXT NOT NULL,
				date TEXT NOT NULL,
				completed INTEGER NOT NULL DEFAULT 0
			)`,
			`CREATE INDEX IF NOT EXISTS completions_user_updated_idx ON habit_completions (user_id, updated_at)`,
			`CREATE INDEX IF NOT EXISTS completions_habit_date_idx ON habit_completions (user_id, habit_id, date)`,

			`CREATE TABLE IF NOT EXISTS finance_entries (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				date TEXT NOT NULL,
				type TEXT NOT NULL,
				amount REAL NOT NULL,
				category TEXT NOT NULL,
				note TEXT
			)`,
			`CREATE INDEX IF NOT EXISTS finance_user_updated_idx ON finance_entries (user_id, updated_at)`,
			`CREATE INDEX IF NOT EXISTS finance_user_date_idx ON finance_entries (user_id, date)`,

			`CREATE TABLE IF NOT EXISTS daily_nutrition (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				date TEXT NOT NULL,
				calorie_goal REAL NOT NULL,
				protein_goal REAL NOT NULL,
				fat_goal REAL NOT NULL,
				carbs_goal REAL NOT NULL,
				water_goal_ml REAL NOT NULL,
				water_consumed_ml REAL NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS nutrition_user_updated_idx ON daily_nutrition (user_id, updated_at)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS nutrition_user_date_idx ON daily_nutrition (user_id, date)`,

			`CREATE TABLE IF NOT EXISTS daily_finance (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				date TEXT NOT NULL,
				budget REAL NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS finance_day_user_updated_idx ON daily_finance (user_id, updated_at)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS finance_day_user_date_idx ON daily_finance (user_id, date)`,

			`CREATE TABLE IF NOT EXISTS pending_scans (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				payload TEXT NOT NULL,
				created_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS pending_scans_user_idx ON pending_scans (user_id, created_at)`
		]
	},
	{
		name: '0002_rate_limits',
		statements: [
			// Счётчики частоты в базе, а не в памяти процесса: иначе предел
			// обнуляется на каждом развёртывании, а на втором инстансе
			// начинается заново — и платный вызов распознавания можно
			// раскрутить простым чередованием.
			`CREATE TABLE IF NOT EXISTS rate_limits (
				key TEXT PRIMARY KEY,
				count INTEGER NOT NULL,
				reset_at INTEGER NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits (reset_at)`
		]
	},
	{
		name: '0003_billing',
		statements: [
			// Подписка хранится отдельно от пользователя: у неё своя жизнь
			// (продления, отмены, возвраты), и перезаписывать её вместе
			// с именем из Telegram было бы неверно. expires_at — момент
			// окончания оплаченного периода, charge_id нужен для возврата,
			// subscription_id — для автопродления звёздами.
			`CREATE TABLE IF NOT EXISTS subscriptions (
				user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
				plan TEXT NOT NULL,
				status TEXT NOT NULL,
				expires_at TEXT,
				charge_id TEXT,
				subscription_id TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS subscriptions_expires_idx ON subscriptions (expires_at)`,

			// Журнал платежей: нужен для возвратов, разбора спорных списаний
			// и простого ответа на вопрос «за что списали». Удалять записи
			// отсюда нельзя даже при отмене подписки.
			`CREATE TABLE IF NOT EXISTS payments (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				charge_id TEXT NOT NULL,
				stars INTEGER NOT NULL,
				payload TEXT NOT NULL,
				status TEXT NOT NULL,
				created_at TEXT NOT NULL
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS payments_charge_idx ON payments (charge_id)`,
			`CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id, created_at)`
		]
	},
	{
		name: '0004_plan_items',
		statements: [
			`CREATE TABLE IF NOT EXISTS plan_items (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				date TEXT NOT NULL,
				title TEXT NOT NULL,
				time TEXT,
				kind TEXT NOT NULL,
				done INTEGER NOT NULL DEFAULT 0,
				note TEXT
			)`,
			`CREATE INDEX IF NOT EXISTS plan_user_updated_idx ON plan_items (user_id, updated_at)`,
			`CREATE INDEX IF NOT EXISTS plan_user_date_idx ON plan_items (user_id, date)`
		]
	},
	{
		// Приём пищи у записи. Колонка добавляется пустой: у всего, что уже
		// записано, приёма нет, и подставлять его задним числом нельзя —
		// в интерфейсе такие записи раскладываются по времени создания.
		name: '0005_food_meal',
		statements: [`ALTER TABLE food_entries ADD COLUMN meal TEXT`]
	}
];
