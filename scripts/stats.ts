/**
 * Воронка и источники в терминале — те же цифры, что на экране /admin.
 *
 *   node scripts/stats.ts
 *
 * База берётся из DATABASE_URL, а если он пуст — из TARGET_DATABASE_URL.
 * Только чтение: скрипт не применяет миграции и ничего не пишет. На базе
 * без шага 0009_activity он так и скажет, вместо того чтобы молча
 * показать нули.
 */

import { createClient } from '@libsql/client';
import {
	collectStats,
	sourceLabel,
	type Funnel,
	type Rate,
	type SourceStats
} from '../src/lib/stats/metrics.ts';

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

const applied = await db
	.execute("SELECT 1 FROM schema_migrations WHERE name = '0009_activity'")
	.catch(() => ({ rows: [] }));
if (applied.rows.length === 0) {
	console.error('На этой базе нет миграции 0009_activity — статистику считать не из чего.');
	console.error('Она применяется при старте приложения.');
	db.close();
	process.exit(1);
}

const stats = await collectStats(async (sql, args = []) => {
	const result = await db.execute({ sql, args });
	return result.rows as unknown as Record<string, unknown>[];
});

const percent = (value: Rate) => (value.rate === null ? '—' : `${Math.round(value.rate * 100)}%`);
const share = (value: Rate) => `${value.count}/${value.of} (${percent(value)})`;
const bar = (value: Rate) => '█'.repeat(Math.round((value.rate ?? 0) * 24)).padEnd(24, '·');

function funnelLines(title: string, funnel: Funnel) {
	console.log(`\n${title}`);
	console.log(`  Пришли           ${funnel.started}`);
	console.log(`  Открыли app      ${bar(funnel.opened)} ${share(funnel.opened)}`);
	console.log(`  Первая запись    ${bar(funnel.activated)} ${share(funnel.activated)}`);
	console.log(`  Вернулись D1     ${bar(funnel.d1)} ${share(funnel.d1)}`);
	console.log(`  Вернулись D7     ${bar(funnel.d7)} ${share(funnel.d7)}`);
}

function sourceRows(sources: SourceStats[]) {
	return sources.map((item) => ({
		источник: sourceLabel(item.source),
		пришли: item.started,
		открыли: percent(item.opened),
		запись: percent(item.activated),
		D1: percent(item.d1),
		D7: percent(item.d7)
	}));
}

console.log(`База: ${normalized.replace(/\/\/[^@/]*@/, '//***@')}`);
console.log(
	`Сегодня (UTC): ${stats.today}. Тестовых аккаунтов не в счёте: ${stats.excludedTestAccounts}.`
);
console.log(
	`Всего людей: ${stats.totals.started} · сегодня +${stats.totals.newToday} · ` +
		`за 7 дней +${stats.totals.newLast7}`
);
console.log(`Pro сейчас: ${stats.pro.active} (платили: ${stats.pro.paying})`);
console.log(
	`Приглашения: ${stats.referrals.invited} пришли, ${stats.referrals.qualified} засчитаны, ` +
		`${stats.referrals.pending} ждут записи, пригласивших ${stats.referrals.inviters}, ` +
		`роздано ${stats.referrals.daysGranted} дн. Pro`
);

funnelLines(`Воронка за ${stats.windowDays} дней`, stats.funnel);
funnelLines('Воронка за всё время', stats.totals);

console.log(`\nИсточники за ${stats.windowDays} дней`);
console.table(sourceRows(stats.sources));
console.log('Источники за всё время');
console.table(sourceRows(stats.sourcesAllTime));

console.log(`Когорты по дням (UTC), «—» — день возврата ещё не наступил`);
console.table(
	stats.cohorts
		.filter((day) => day.users > 0)
		.map((day) => ({
			день: day.date,
			пришли: day.users,
			открыли: day.opened,
			запись: day.activated,
			D1: day.d1 ?? '—',
			D7: day.d7 ?? '—'
		}))
);

db.close();
