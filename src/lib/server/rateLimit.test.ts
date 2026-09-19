import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, runMigrations, type Db } from './db/client';
import { checkRateLimit, purgeExpiredRateLimits } from './rateLimit';

let db: Db;

const WINDOW = 60_000;
const NOW = 1_800_000_000_000;

beforeEach(async () => {
	db = await createTestDb();
});

describe('checkRateLimit', () => {
	it('пропускает, пока не исчерпан предел', async () => {
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const result = await checkRateLimit('user:1', 3, WINDOW, { db, now: NOW });
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(3 - attempt);
		}
	});

	it('отказывает после превышения и говорит, сколько ждать', async () => {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			await checkRateLimit('user:1', 3, WINDOW, { db, now: NOW });
		}

		const result = await checkRateLimit('user:1', 3, WINDOW, { db, now: NOW });

		expect(result.allowed).toBe(false);
		expect(result.retryAfterSeconds).toBeGreaterThan(0);
		expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
	});

	it('считает ключи независимо', async () => {
		await checkRateLimit('user:1', 1, WINDOW, { db, now: NOW });
		const other = await checkRateLimit('user:2', 1, WINDOW, { db, now: NOW });

		expect(other.allowed).toBe(true);
	});

	it('открывает новое окно, когда прежнее истекло', async () => {
		await checkRateLimit('user:1', 1, WINDOW, { db, now: NOW });
		expect((await checkRateLimit('user:1', 1, WINDOW, { db, now: NOW })).allowed).toBe(false);

		const later = await checkRateLimit('user:1', 1, WINDOW, { db, now: NOW + WINDOW + 1 });

		expect(later.allowed).toBe(true);
	});

	it('переживает перезапуск процесса', async () => {
		// Именно ради этого счётчики лежат в базе: раньше предел обнулялся
		// при каждом развёртывании, и платный вызов можно было раскрутить.
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await checkRateLimit('user:1', 2, WINDOW, { db, now: NOW });
		}

		// Новое подключение к той же базе — как новый инстанс приложения.
		await runMigrations(db);
		const afterRestart = await checkRateLimit('user:1', 2, WINDOW, { db, now: NOW });

		expect(afterRestart.allowed).toBe(false);
	});

	it('при недоступной базе пропускает запрос, а не роняет сценарий', async () => {
		const broken = {
			insert: () => {
				throw new Error('база недоступна');
			}
		} as unknown as Db;

		expect((await checkRateLimit('user:1', 1, WINDOW, { db: broken, now: NOW })).allowed).toBe(
			true
		);
	});
});

describe('purgeExpiredRateLimits', () => {
	it('убирает истёкшие окна и не трогает живые', async () => {
		await checkRateLimit('old', 5, WINDOW, { db, now: NOW });
		await checkRateLimit('fresh', 5, WINDOW, { db, now: NOW + WINDOW });

		await purgeExpiredRateLimits({ db, now: NOW + WINDOW + 1 });

		// У убранного ключа счёт начинается заново, у живого — продолжается.
		const old = await checkRateLimit('old', 5, WINDOW, { db, now: NOW + WINDOW + 2 });
		const fresh = await checkRateLimit('fresh', 5, WINDOW, { db, now: NOW + WINDOW + 2 });

		expect(old.remaining).toBe(4);
		expect(fresh.remaining).toBe(3);
	});
});
