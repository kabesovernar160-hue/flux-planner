/**
 * Настройка профиля бота в Telegram: команды, кнопка меню, описания.
 *
 * Всё это живёт не в коде приложения, а на стороне Telegram, и по умолчанию
 * пусто: пользователь открывает чат и видит бота без единой подсказки —
 * ни списка команд, ни кнопки запуска приложения. Руками в BotFather это
 * делается кликами, которые никто не помнит через месяц; здесь то же самое
 * записано один раз и повторяется одинаково для любого бота.
 *
 * Запуск:
 *   npm run bot:setup
 *
 * Требуются TELEGRAM_BOT_TOKEN и TELEGRAM_MINI_APP_URL (публичный HTTPS-адрес
 * приложения). Имя и аватар остаются за BotFather: Bot API их не меняет.
 */

const API_BASE = 'https://api.telegram.org';

/** Команды, которые действительно обрабатывает вебхук. */
const COMMANDS = [
	{ command: 'start', description: 'Открыть Flux Planner' },
	{ command: 'app', description: 'Открыть приложение' },
	{ command: 'help', description: 'Что умею в чате' },
	{ command: 'feedback', description: 'Написать отзыв разработчику' }
];

/** Показывается в пустом чате, до первого сообщения. До 512 символов. */
const DESCRIPTION = [
	'Питание, привычки и финансы одного дня на одном экране.',
	'',
	'Пришлите фото блюда — разберу его на продукты и посчитаю калории.',
	'Напишите «450 борщ» — запишу сразу. В дневник попадёт только то,',
	'что вы подтвердили.'
].join('\n');

/** Показывается в профиле бота и в поиске. До 120 символов. */
const SHORT_DESCRIPTION = 'Питание, привычки и финансы одного дня на одном экране.';

/** Текст кнопки меню в чате. Telegram обрезает длинное. */
const MENU_BUTTON_TEXT = 'Открыть';

function required(name: string): string {
	const value = process.env[name]?.trim();

	if (!value) {
		console.error(`[setup] Не задана переменная ${name}.`);
		process.exit(1);
	}

	return value;
}

async function call(token: string, method: string, payload: unknown): Promise<void> {
	const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(20_000)
	});

	const data = (await response.json().catch(() => null)) as {
		ok?: boolean;
		description?: string;
	} | null;

	if (!response.ok || !data?.ok) {
		throw new Error(`${method}: ${data?.description ?? response.status}`);
	}

	console.log(`[setup] ${method} ✓`);
}

async function main(): Promise<void> {
	try {
		process.loadEnvFile?.('.env');
	} catch {
		/* переменные могут приходить из окружения процесса */
	}

	const token = required('TELEGRAM_BOT_TOKEN');
	const miniAppUrl = required('TELEGRAM_MINI_APP_URL').replace(/\/+$/, '');

	if (new URL(miniAppUrl).protocol !== 'https:') {
		// Telegram отвергает web_app с http, и кнопка меню просто не поставится.
		console.error('[setup] TELEGRAM_MINI_APP_URL должен начинаться с https://');
		process.exit(1);
	}

	await call(token, 'setMyCommands', { commands: COMMANDS });
	await call(token, 'setMyDescription', { description: DESCRIPTION });
	await call(token, 'setMyShortDescription', { short_description: SHORT_DESCRIPTION });
	await call(token, 'setChatMenuButton', {
		menu_button: { type: 'web_app', text: MENU_BUTTON_TEXT, web_app: { url: miniAppUrl } }
	});

	console.log(`[setup] готово: кнопка меню ведёт на ${miniAppUrl}`);
	console.log('[setup] имя, аватар и Main Mini App — в BotFather, Bot API их не меняет.');
}

main().catch((error: unknown) => {
	console.error('[setup]', error);
	process.exit(1);
});
