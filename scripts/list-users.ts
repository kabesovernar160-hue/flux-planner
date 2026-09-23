/**
 * Список пользователей: кто пришёл, когда заходил последний раз, пользуется ли.
 *
 *   node scripts/list-users.ts
 *
 * База берётся из DATABASE_URL, а если он пуст — из TARGET_DATABASE_URL.
 * Только чтение.
 */

import { createClient } from '@libsql/client';

try {
	process.loadEnvFile?.('.env');
} catch {
	/* переменные могут приходить из окружения процесса */
}

const env = (name: string) => process.env[name]?.trim() ?? '';
const url = env('DATABASE_URL') || env('TARGET_DATABASE_URL');
if (!url) throw new Error('Не задан ни DATABASE_URL, ни TARGET_DATABASE_URL.');
const authToken = env('DATABASE_URL')
	? env('DATABASE_AUTH_TOKEN')
	: env('TARGET_DATABASE_AUTH_TOKEN');
const normalized = url.startsWith('file:') || url.includes('://') ? url : `file:${url}`;
const db = createClient({ url: normalized, authToken: authToken || undefined });

const live = (table: string) =>
	`(SELECT count(*) FROM ${table} t WHERE t.user_id = u.id AND t.deleted_at IS NULL)`;

const { rows } = await db.execute(`
	SELECT u.telegram_user_id AS tid, u.username, u.first_name,
	       substr(u.created_at, 1, 10) AS joined,
	       (SELECT substr(p.updated_at, 1, 10) FROM planner_state p WHERE p.user_id = u.id) AS seen,
	       ${live('food_entries')} AS food,
	       ${live('habits')} AS habits,
	       ${live('finance_entries')} AS money,
	       (SELECT s.plan || ' до ' || coalesce(substr(s.expires_at, 1, 10), '∞')
	          FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active') AS pro
	FROM users u
	ORDER BY u.created_at
`);

console.log(
	`База: ${normalized.replace(/\/\/[^@/]*@/, '//***@')}\nПользователей: ${rows.length}\n`
);
console.table(
	rows.map((r) => ({
		id: r.tid,
		ник: r.username ? `@${r.username}` : '—',
		имя: r.first_name ?? '—',
		пришёл: r.joined,
		заходил: r.seen ?? '—',
		еда: r.food,
		привычки: r.habits,
		траты: r.money,
		pro: r.pro ?? ''
	}))
);
db.close();
