import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

/**
 * Конфигурация сервера в одном месте.
 *
 * Раньше каждый модуль читал `env` сам и по-своему решал, что делать
 * с пропущенным значением. В продакшене это худший из вариантов: приложение
 * поднимается как ни в чём не бывало и ломается на первом живом запросе,
 * когда об этом узнаёт уже пользователь. Здесь конфигурация собирается один
 * раз и проверяется на старте — «не запустился с понятной ошибкой» лучше,
 * чем «запустился и молча не работает».
 */

export interface ServerConfig {
	/** Токен бота. Без него нечем проверить подпись Telegram. */
	botToken: string;
	/** Публичный адрес Mini App по HTTPS. */
	miniAppUrl: string;
	/** Секрет вебхука: Telegram присылает его в заголовке. */
	webhookSecret: string;
	/** Ключ провайдера распознавания. */
	aiApiKey: string;
	/** Адрес базы: файл для разработки или libsql/https для хостинга. */
	databaseUrl: string;
	/** Токен доступа к базе. Нужен только для удалённой. */
	databaseAuthToken: string;
	/** Секрет cron-эндпоинта ежедневной рассылки. */
	cronSecret: string;
	/**
	 * Осознанное согласие на файловую базу в продакшене.
	 *
	 * Один сервер с постоянным диском — нормальное развёртывание, и файл там
	 * переживёт всё. А вот на serverless-хостинге тот же файл исчезает вместе
	 * с контейнером. Отличить одно от другого автоматически нельзя, поэтому
	 * решение остаётся за тем, кто разворачивает, — но принять его нужно явно.
	 */
	allowFileDatabase: boolean;
	isDev: boolean;
}

export interface ConfigProblem {
	variable: string;
	message: string;
	/** fatal — приложение не должно подниматься, warning — часть возможностей выключена. */
	level: 'fatal' | 'warning';
}

const DEFAULT_DATABASE_URL = 'file:flux-planner.db';

function read(value: string | undefined): string {
	return value?.trim() ?? '';
}

export function readConfig(
	source: Record<string, string | undefined> = env,
	isDev = dev
): ServerConfig {
	return {
		botToken: read(source.TELEGRAM_BOT_TOKEN),
		miniAppUrl: read(source.TELEGRAM_MINI_APP_URL),
		webhookSecret: read(source.TELEGRAM_WEBHOOK_SECRET),
		aiApiKey: read(source.AI_API_KEY),
		databaseUrl: read(source.DATABASE_URL) || DEFAULT_DATABASE_URL,
		databaseAuthToken: read(source.DATABASE_AUTH_TOKEN),
		cronSecret: read(source.CRON_SECRET),
		allowFileDatabase: read(source.ALLOW_FILE_DATABASE).toLowerCase() === 'true',
		isDev
	};
}

/**
 * Проверка конфигурации.
 *
 * Разделение на fatal и warning не формальность: без токена бота приложение
 * бесполезно целиком, а без ключа ИИ оно просто работает без распознавания
 * по фото — это рабочее состояние, а не поломка.
 */
export function validateConfig(config: ServerConfig): ConfigProblem[] {
	const problems: ConfigProblem[] = [];

	if (!config.botToken) {
		problems.push({
			variable: 'TELEGRAM_BOT_TOKEN',
			message: 'нечем проверить подпись Telegram: вход и синхронизация работать не будут',
			level: config.isDev ? 'warning' : 'fatal'
		});
	}

	if (!config.isDev && isLocalFile(config.databaseUrl) && !config.allowFileDatabase) {
		// На serverless-хостинге файл исчезает вместе с контейнером, и это
		// потеря данных пользователя, а не неудобство. На своём сервере
		// с постоянным диском он в порядке — но сказать об этом надо явно.
		problems.push({
			variable: 'DATABASE_URL',
			message:
				'файловая база в продакшене: укажите libsql://… или подтвердите постоянный диск через ALLOW_FILE_DATABASE=true',
			level: 'fatal'
		});
	}

	if (!config.isDev && isLocalFile(config.databaseUrl) && config.allowFileDatabase) {
		problems.push({
			variable: 'DATABASE_URL',
			message:
				'файловая база разрешена вручную — убедитесь, что диск постоянный и есть резервные копии',
			level: 'warning'
		});
	}

	if (isRemoteDatabase(config.databaseUrl) && !config.databaseAuthToken) {
		problems.push({
			variable: 'DATABASE_AUTH_TOKEN',
			message: 'удалённая база требует токен доступа',
			level: 'fatal'
		});
	}

	if (!config.aiApiKey) {
		problems.push({
			variable: 'AI_API_KEY',
			message: config.isDev ? 'распознавание работает на моке' : 'распознавание по фото отключено',
			level: 'warning'
		});
	}

	if (!config.webhookSecret) {
		problems.push({
			variable: 'TELEGRAM_WEBHOOK_SECRET',
			message: 'вебхук бота отвечает 401 на всё',
			level: 'warning'
		});
	}

	if (config.miniAppUrl && !isHttpsUrl(config.miniAppUrl)) {
		problems.push({
			variable: 'TELEGRAM_MINI_APP_URL',
			message: 'Telegram принимает только https-адрес, кнопка запуска не появится',
			level: 'warning'
		});
	} else if (!config.miniAppUrl) {
		problems.push({
			variable: 'TELEGRAM_MINI_APP_URL',
			message: 'бот не сможет показать кнопку открытия приложения',
			level: 'warning'
		});
	}

	if (!config.cronSecret) {
		problems.push({
			variable: 'CRON_SECRET',
			message: 'ежедневная рассылка отключена',
			level: 'warning'
		});
	}

	return problems;
}

export function isLocalFile(url: string): boolean {
	return url.startsWith('file:') || url === ':memory:' || !url.includes('://');
}

export function isRemoteDatabase(url: string): boolean {
	return /^(libsql|wss?|https?):\/\//.test(url);
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}

let cached: ServerConfig | null = null;

export function getConfig(): ServerConfig {
	cached ??= readConfig();
	return cached;
}

/** Только для тестов: сбросить закешированную конфигурацию. */
export function resetConfigForTests(): void {
	cached = null;
}
