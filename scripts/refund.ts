/**
 * Возврат звёзд за платёж — то, чем отвечают на письмо «верните деньги».
 *
 * В продукте автоматического возврата нет намеренно: решение принимает
 * человек. Но и делать это руками через сырой вызов Bot API, подбирая
 * идентификатор платежа глазами по базе, — верный способ однажды вернуть
 * не тот платёж не тому человеку.
 *
 * Скрипт показывает платежи и возвращает выбранный. Доступ снимается сам:
 * Telegram присылает refunded_payment, вебхук помечает платёж возвращённым
 * и закрывает Pro.
 *
 * Посмотреть платежи человека:
 *   node scripts/refund.ts 1145673466
 *
 * Вернуть последний успешный:
 *   node scripts/refund.ts 1145673466 --confirm
 *
 * Вернуть конкретный:
 *   node scripts/refund.ts 1145673466 --charge <id> --confirm
 *
 * База берётся из DATABASE_URL, а если он пуст — из TARGET_DATABASE_URL:
 * на машине разработчика прод живёт именно там.
 */

import { createClient, type Client } from '@libsql/client';

const API_BASE = 'https://api.telegram.org';

function env(name: string): string {
	return process.env[name]?.trim() ?? '';
}

/** Открытое соединение. Закрывается в самом конце, когда запросов уже нет. */
let open: Client | null = null;

/**
 * Остановка с понятной причиной.
 *
 * Именно исключение, а не process.exit: драйвер libSQL держит дескрипторы,
 * и мгновенный выход роняет Node ассертом libuv прямо поверх сообщения,
 * которое человек должен прочитать.
 */
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
	const telegramUserId = args.find((arg) => !arg.startsWith('--'));
	const confirm = args.includes('--confirm');
	const chargeArg = args[args.indexOf('--charge') + 1];
	const chargeId = args.includes('--charge') ? chargeArg : undefined;

	if (!telegramUserId) fail('Нужен telegram id человека: node scripts/refund.ts <id> [--confirm]');

	const token = env('TELEGRAM_BOT_TOKEN');
	if (!token) fail('Не задан TELEGRAM_BOT_TOKEN.');

	const { client, url } = connect();
	console.log(`[refund] база: ${url.split('?')[0]}`);

	const user = await client.execute({
		sql: 'SELECT id, username FROM users WHERE telegram_user_id = ?',
		args: [String(telegramUserId)]
	});

	if (user.rows.length === 0) fail(`Пользователь ${telegramUserId} не найден.`);

	const payments = await client.execute({
		sql: 'SELECT charge_id, stars, status, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC',
		args: [String(user.rows[0].id)]
	});

	if (payments.rows.length === 0) fail('Платежей у этого человека нет.');

	console.log(`[refund] платежи ${user.rows[0].username ?? telegramUserId}:`);
	for (const row of payments.rows) {
		console.log(`  ${row.created_at}  ${row.stars}⭐  ${row.status}  ${row.charge_id}`);
	}

	const target = chargeId
		? payments.rows.find((row) => row.charge_id === chargeId)
		: payments.rows.find((row) => row.status === 'paid');

	if (!target)
		fail(chargeId ? 'Такого платежа у него нет.' : 'Нечего возвращать: успешных платежей нет.');

	if (!confirm) {
		// Возврат необратим, поэтому по умолчанию скрипт только показывает.
		console.log(`[refund] вернуть ${target.stars}⭐ (${target.charge_id}) — добавьте --confirm`);
		return;
	}

	const response = await fetch(`${API_BASE}/bot${token}/refundStarPayment`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			user_id: Number(telegramUserId),
			telegram_payment_charge_id: String(target.charge_id)
		})
	});

	const payload = (await response.json()) as { ok: boolean; description?: string };

	if (!payload.ok) fail(`Telegram отказал: ${payload.description ?? response.status}`);

	// Статус в базе меняет вебхук, получив refunded_payment: делать это здесь
	// значило бы держать вторую версию правды о том, что считается возвратом.
	console.log(`[refund] возвращено ${target.stars}⭐. Доступ снимет вебхук, это занимает секунды.`);
}

void main()
	.catch((error) => {
		console.error(error instanceof Stop ? `[refund] ${error.message}` : error);
		process.exitCode = 1;
	})
	.finally(() => open?.close());
