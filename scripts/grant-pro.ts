/**
 * Выдача Pro вручную — тестерам и на разбор жалоб.
 *
 * Это не оплата: в таблице платежей ничего не появляется, деньги не двигаются,
 * звёзды никто не тратил. Подписка просто ставится в базу со сроком, после
 * которого сама истечёт, — поэтому забытый тестер не остаётся с Pro навсегда.
 *
 * Показать, что сейчас:
 *   node scripts/grant-pro.ts 1145673466
 *
 * Выдать на 30 дней:
 *   node scripts/grant-pro.ts 1145673466 --days 30 --confirm
 *
 * Забрать:
 *   node scripts/grant-pro.ts 1145673466 --revoke --confirm
 *
 * База берётся из DATABASE_URL, а если он пуст — из TARGET_DATABASE_URL.
 */

import { createClient, type Client } from '@libsql/client';

function env(name: string): string {
	return process.env[name]?.trim() ?? '';
}

let open: Client | null = null;

/** Остановка с понятной причиной: process.exit роняет драйвер поверх сообщения. */
class Stop extends Error {}

function fail(message: string): never {
	throw new Stop(message);
}

function connect(): { client: Client; url: string } {
	const url = env('DATABASE_URL') || env('TARGET_DATABASE_URL');
	if (!url) fail('Не задан ни DATABASE_URL, ни TARGET_DATABASE_URL.');

	const authToken = env('DATABASE_URL')
		? env('DATABASE_AUTH_TOKEN')
		: env('TARGET_DATABASE_AUTH_TOKEN');

	const normalized = url.startsWith('file:') || url.includes('://') ? url : `file:${url}`;

	open = normalized.startsWith('file:')
		? createClient({ url: normalized })
		: createClient({ url: normalized, authToken: authToken || undefined });

	return { client: open, url: normalized };
}

async function main(): Promise<void> {
	try {
		process.loadEnvFile?.('.env');
	} catch {
		/* переменные могут приходить из окружения процесса */
	}

	const args = process.argv.slice(2);
	const daysIndex = args.indexOf('--days');
	const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) : 30;
	const confirm = args.includes('--confirm');
	const revoke = args.includes('--revoke');

	// Значение --days тоже выглядит как число без дефисов, поэтому оно
	// исключается явно: иначе «--days 30» превратилось бы в id пользователя.
	const telegramUserId = args.find(
		(arg, index) => !arg.startsWith('--') && !(daysIndex >= 0 && index === daysIndex + 1)
	);

	if (!telegramUserId)
		fail('Нужен telegram id: node scripts/grant-pro.ts <id> [--days 30] [--confirm]');
	if (!Number.isFinite(days) || days <= 0) fail('--days должен быть положительным числом.');

	const { client, url } = connect();
	console.log(`[pro] база: ${url.split('?')[0]}`);

	const user = await client.execute({
		sql: 'SELECT id, username, first_name FROM users WHERE telegram_user_id = ?',
		args: [String(telegramUserId)]
	});

	if (user.rows.length === 0) {
		fail(`Пользователя ${telegramUserId} нет в базе — пусть сначала откроет приложение.`);
	}

	const userId = String(user.rows[0].id);
	const who = user.rows[0].username ?? user.rows[0].first_name ?? telegramUserId;

	const current = await client.execute({
		sql: 'SELECT plan, status, expires_at FROM subscriptions WHERE user_id = ?',
		args: [userId]
	});

	console.log(
		current.rows.length === 0
			? `[pro] ${who}: подписки нет`
			: `[pro] ${who}: ${current.rows[0].plan} / ${current.rows[0].status} до ${current.rows[0].expires_at}`
	);

	if (!confirm) {
		console.log(
			revoke
				? '[pro] забрать — добавьте --confirm'
				: `[pro] выдать на ${days} дней — добавьте --confirm`
		);
		return;
	}

	const now = new Date();
	const timestamp = now.toISOString();

	if (revoke) {
		await client.execute({
			sql: `UPDATE subscriptions SET plan = 'free', status = 'cancelled', expires_at = ?, updated_at = ?
			      WHERE user_id = ?`,
			args: [timestamp, timestamp, userId]
		});

		console.log(`[pro] ${who}: Pro снят.`);
		return;
	}

	const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

	// Ручная выдача перекрывает прежнюю строку целиком: у человека одна
	// подписка, и две записи о ней означали бы два разных ответа на вопрос,
	// что ему сейчас доступно.
	await client.execute({
		sql: `INSERT INTO subscriptions (user_id, plan, status, expires_at, created_at, updated_at)
		      VALUES (?, 'pro', 'active', ?, ?, ?)
		      ON CONFLICT (user_id) DO UPDATE SET
		        plan = 'pro', status = 'active', expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
		args: [userId, expiresAt, timestamp, timestamp]
	});

	console.log(`[pro] ${who}: Pro до ${expiresAt}. В приложении обновится при следующем открытии.`);
}

void main()
	.catch((error) => {
		console.error(error instanceof Stop ? `[pro] ${error.message}` : error);
		process.exitCode = 1;
	})
	.finally(() => open?.close());
