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
	},
	{
		// Дневник веса. Уникальность по паре «пользователь + день»: одна
		// запись на сутки, иначе два устройства развели бы один день
		// на две строки и график получил бы ступеньку из ниоткуда.
		name: '0006_weight_entries',
		statements: [
			`CREATE TABLE IF NOT EXISTS weight_entries (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				date TEXT NOT NULL,
				weight_kg REAL NOT NULL,
				note TEXT
			)`,
			`CREATE INDEX IF NOT EXISTS weight_user_updated_idx ON weight_entries (user_id, updated_at)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS weight_user_date_idx ON weight_entries (user_id, date)`
		]
	},
	{
		// Ключи быстрой записи с телефона. Хранится только хеш: утёкшая
		// база не должна открывать доступ к чужим дневникам.
		name: '0007_capture_tokens',
		statements: [
			`CREATE TABLE IF NOT EXISTS capture_tokens (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				token_hash TEXT NOT NULL,
				created_at TEXT NOT NULL,
				last_used_at TEXT,
				revoked_at TEXT
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS capture_token_hash_idx ON capture_tokens (token_hash)`,
			`CREATE INDEX IF NOT EXISTS capture_token_user_idx ON capture_tokens (user_id)`
		]
	},
	{
		// Реферальная программа. Две таблицы, а не колонки в users: код
		// выдаётся лениво, только тем, кто открыл экран приглашения, а у
		// приглашения своя жизнь — ожидание первой записи и засчитывание.
		name: '0008_referrals',
		statements: [
			// Код — случайная строка, а не производное от telegram id: ссылку
			// пересылают в чаты, и по ней нельзя узнать, чья она.
			`CREATE TABLE IF NOT EXISTS referral_codes (
				user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
				code TEXT NOT NULL,
				created_at TEXT NOT NULL
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (code)`,

			// Одна строка на приглашённого. invitee_key — HMAC от telegram id:
			// удалённый аккаунт обезличивается, и вход тем же Telegram заводит
			// нового пользователя. Без ключа его можно было бы «пригласить»
			// заново и получать дни Pro по кругу. Сам id при этом не хранится.
			// Дни хранятся на строке, чтобы лимит считался суммой по ним,
			// а не пересчётом правил задним числом.
			`CREATE TABLE IF NOT EXISTS referrals (
				id TEXT PRIMARY KEY,
				inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				invitee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				invitee_key TEXT NOT NULL,
				status TEXT NOT NULL,
				invitee_days INTEGER NOT NULL DEFAULT 0,
				inviter_days INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				qualified_at TEXT
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS referrals_invitee_idx ON referrals (invitee_id)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS referrals_invitee_key_idx ON referrals (invitee_key)`,
			`CREATE INDEX IF NOT EXISTS referrals_inviter_idx ON referrals (inviter_id, status)`
		]
	},
	{
		// Воронка активации: откуда пришёл, открыл ли приложение, сделал ли
		// первую запись, вернулся ли. Колонки в users, а не отдельная таблица:
		// каждая — один факт на человека, который ставится один раз.
		name: '0009_activity',
		statements: [
			`ALTER TABLE users ADD COLUMN source TEXT`,
			`ALTER TABLE users ADD COLUMN app_opened_at TEXT`,
			`ALTER TABLE users ADD COLUMN first_record_at TEXT`,

			// День, а не каждый вход: для возврата на первый и седьмой день
			// больше не нужно, а таблица растёт не быстрее, чем число
			// активных людей на число дней. WITHOUT ROWID — ключ и есть данные.
			`CREATE TABLE IF NOT EXISTS user_activity (
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				date TEXT NOT NULL,
				PRIMARY KEY (user_id, date)
			) WITHOUT ROWID`,

			// Задним числом — то, что выводится из уже накопленного.
			//
			// Источник: приглашённых видно по referrals, про остальных до этой
			// миграции ничего не записывалось. 'unknown', а не пусто: пустое
			// значение приложение заполнило бы при следующем входе, и давний
			// пользователь вдруг оказался бы «пришедшим напрямую» сегодня.
			`UPDATE users SET source = CASE
				WHEN EXISTS (SELECT 1 FROM referrals r WHERE r.invitee_id = users.id) THEN 'referral'
				ELSE 'unknown'
			END
			WHERE source IS NULL`,

			// Открытие приложения. До этой миграции /start строку не заводил:
			// она появлялась при входе в Mini App или при сообщении боту,
			// и второе — редкость. Поэтому момент заведения и есть первое
			// открытие, с малой погрешностью в пользу воронки.
			`UPDATE users SET app_opened_at = created_at WHERE app_opened_at IS NULL`,

			// Первая запись — самая ранняя строка любого вида, но не раньше
			// заведения пользователя: восстановленный из файла дневник несёт
			// старые даты, а сделан был сегодня. max() с NULL даёт NULL —
			// у кого записей нет, у того и отметки нет.
			`UPDATE users SET first_record_at = (
				SELECT max(users.created_at, min(t.created_at)) FROM (
					SELECT created_at FROM food_entries WHERE user_id = users.id
					UNION ALL SELECT created_at FROM habits WHERE user_id = users.id
					UNION ALL SELECT created_at FROM finance_entries WHERE user_id = users.id
					UNION ALL SELECT created_at FROM plan_items WHERE user_id = users.id
					UNION ALL SELECT created_at FROM weight_entries WHERE user_id = users.id
				) t
			)
			WHERE first_record_at IS NULL`,

			// Дни присутствия: день заведения, день последнего входа и дни,
			// когда появлялись записи. Это приближение — запись могла прийти
			// и от бота, — но без него возврат по старым когортам был бы нулём,
			// а это заведомо неправда. Даты до заведения и из будущего
			// (сбитые часы телефона) отбрасываются.
			`INSERT OR IGNORE INTO user_activity (user_id, date)
			SELECT d.user_id, d.day FROM (
				SELECT id AS user_id, substr(created_at, 1, 10) AS day FROM users
				UNION SELECT id, substr(updated_at, 1, 10) FROM users
				UNION SELECT user_id, substr(created_at, 1, 10) FROM food_entries
				UNION SELECT user_id, substr(created_at, 1, 10) FROM habits
				UNION SELECT user_id, substr(created_at, 1, 10) FROM habit_completions
				UNION SELECT user_id, substr(created_at, 1, 10) FROM finance_entries
				UNION SELECT user_id, substr(created_at, 1, 10) FROM plan_items
				UNION SELECT user_id, substr(created_at, 1, 10) FROM weight_entries
				UNION SELECT user_id, substr(created_at, 1, 10) FROM daily_nutrition
				UNION SELECT user_id, substr(created_at, 1, 10) FROM daily_finance
			) d
			JOIN users u ON u.id = d.user_id
			WHERE d.day >= substr(u.created_at, 1, 10) AND d.day <= date('now')`,

			// Первая запись отмечается триггером, а не кодом эндпоинтов.
			// Писать в дневник умеют синхронизация, бот, быстрая запись
			// и ассистент, и завтра появится ещё кто-то: условие в каждом из них
			// рано или поздно забыли бы. Триггер срабатывает только на вставку
			// живой строки, а после первой записи UPDATE по первичному ключу
			// с условием IS NULL ничего не меняет — это доли микросекунды.
			// Время — момент записи на сервере, а не createdAt с телефона:
			// часы клиента могут врать, а восстановление из файла — нести
			// даты годичной давности.
			...['food_entries', 'habits', 'finance_entries', 'plan_items', 'weight_entries'].map(
				(table) => `CREATE TRIGGER IF NOT EXISTS ${table}_first_record
				AFTER INSERT ON ${table}
				WHEN NEW.deleted_at IS NULL
				BEGIN
					UPDATE users SET first_record_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
					WHERE id = NEW.user_id AND first_record_at IS NULL;
				END`
			)
		]
	},
	{
		// Напоминания новичкам без записей. Отметка ставится до отправки
		// условным UPDATE: два одновременных вызова планировщика не пришлют
		// одно и то же сообщение дважды. blocked_at — Telegram ответил 403,
		// и писать этому человеку больше нельзя никогда.
		name: '0010_activation_nudges',
		statements: [
			`CREATE TABLE IF NOT EXISTS activation_nudges (
				user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
				first_sent_at TEXT,
				second_sent_at TEXT,
				blocked_at TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`
		]
	},
	{
		// Вход без Telegram: приложение на главном экране телефона.
		// login_tokens — одноразовые коды из бота на десять минут,
		// device_sessions — долгие сессии устройств по куке. В обеих
		// таблицах только хеши: утёкшая база не должна открывать дневники.
		// previous_secret_hash держит прежний секрет несколько минут после
		// ротации, чтобы параллельные запросы со старой кукой не выкинули
		// человека из приложения.
		name: '0011_device_sessions',
		statements: [
			`CREATE TABLE IF NOT EXISTS login_tokens (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				token_hash TEXT NOT NULL,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				used_at TEXT
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS login_token_hash_idx ON login_tokens (token_hash)`,
			`CREATE INDEX IF NOT EXISTS login_token_user_idx ON login_tokens (user_id)`,
			`CREATE TABLE IF NOT EXISTS device_sessions (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				secret_hash TEXT NOT NULL,
				previous_secret_hash TEXT,
				label TEXT NOT NULL,
				created_at TEXT NOT NULL,
				rotated_at TEXT NOT NULL,
				last_seen_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				revoked_at TEXT
			)`,
			`CREATE INDEX IF NOT EXISTS device_session_user_idx ON device_sessions (user_id)`
		]
	}
];
