import { describe, expect, it } from 'vitest';
import { isLocalFile, isRemoteDatabase, readConfig, validateConfig } from './config';

const full = {
	TELEGRAM_BOT_TOKEN: '123:abc',
	TELEGRAM_MINI_APP_URL: 'https://app.example.com',
	TELEGRAM_WEBHOOK_SECRET: 'secret',
	AI_API_KEY: 'sk-test',
	DATABASE_URL: 'libsql://db.example.com',
	DATABASE_AUTH_TOKEN: 'token',
	CRON_SECRET: 'cron'
};

function problems(env: Record<string, string | undefined>, isDev = false) {
	return validateConfig(readConfig(env, isDev));
}

function fatalFor(env: Record<string, string | undefined>, isDev = false) {
	return problems(env, isDev)
		.filter((problem) => problem.level === 'fatal')
		.map((problem) => problem.variable);
}

describe('readConfig', () => {
	it('обрезает пробелы: скопированный токен часто приезжает с ними', () => {
		expect(readConfig({ TELEGRAM_BOT_TOKEN: '  123:abc \n' }).botToken).toBe('123:abc');
	});

	it('подставляет локальный файл, если база не указана', () => {
		expect(readConfig({}).databaseUrl).toBe('file:flux-planner.db');
	});
});

describe('validateConfig', () => {
	it('на полной конфигурации не находит фатальных проблем', () => {
		expect(fatalFor(full)).toEqual([]);
	});

	it('в продакшене требует токен бота', () => {
		const { TELEGRAM_BOT_TOKEN: _, ...rest } = full;

		expect(fatalFor(rest)).toContain('TELEGRAM_BOT_TOKEN');
	});

	it('в разработке отсутствие токена — предупреждение, а не отказ', () => {
		const { TELEGRAM_BOT_TOKEN: _, ...rest } = full;

		expect(fatalFor({ ...rest, DATABASE_URL: 'file:local.db' }, true)).toEqual([]);
	});

	it('в продакшене не даёт запуститься на файловой базе', () => {
		// На serverless-хостинге файл исчезает вместе с контейнером —
		// это потеря данных, а не неудобство.
		expect(fatalFor({ ...full, DATABASE_URL: 'file:local.db' })).toContain('DATABASE_URL');
	});

	it('разрешает файловую базу по явному согласию, но предупреждает', () => {
		const env = { ...full, DATABASE_URL: 'file:local.db', ALLOW_FILE_DATABASE: 'true' };

		expect(fatalFor(env)).toEqual([]);
		expect(
			problems(env).some(
				(problem) => problem.variable === 'DATABASE_URL' && problem.level === 'warning'
			)
		).toBe(true);
	});

	it('требует токен доступа для удалённой базы', () => {
		const { DATABASE_AUTH_TOKEN: _, ...rest } = full;

		expect(fatalFor(rest)).toContain('DATABASE_AUTH_TOKEN');
	});

	it('без ключа ИИ разрешает работу, но предупреждает', () => {
		const { AI_API_KEY: _, ...rest } = full;
		const found = problems(rest);

		expect(found.some((problem) => problem.variable === 'AI_API_KEY')).toBe(true);
		expect(fatalFor(rest)).toEqual([]);
	});

	it('ловит адрес Mini App не по https', () => {
		const found = problems({ ...full, TELEGRAM_MINI_APP_URL: 'http://app.example.com' });

		expect(found.some((problem) => problem.variable === 'TELEGRAM_MINI_APP_URL')).toBe(true);
	});
});

describe('распознавание адреса базы', () => {
	it('отличает локальный файл от удалённой базы', () => {
		expect(isLocalFile('file:flux-planner.db')).toBe(true);
		expect(isLocalFile('flux-planner.db')).toBe(true);
		expect(isLocalFile(':memory:')).toBe(true);
		expect(isLocalFile('libsql://db.example.com')).toBe(false);

		expect(isRemoteDatabase('libsql://db.example.com')).toBe(true);
		expect(isRemoteDatabase('https://db.example.com')).toBe(true);
		expect(isRemoteDatabase('file:local.db')).toBe(false);
	});
});
