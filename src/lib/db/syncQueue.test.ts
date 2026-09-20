import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	clearAllData,
	createDefaultDocument,
	loadPlannerState,
	savePlannerDocument
} from './localDb';
import { resetDriverForTests } from './storage';
import { SyncQueue } from './syncQueue.svelte';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { telegram } from '$lib/telegram';
import type { TelegramWebApp } from '$lib/telegram';

/**
 * Обмен с сервером целиком, от пустого устройства до применения ответа.
 *
 * Поломка, ради которой эти тесты написаны, прошла мимо семисот других:
 * каждый кусок работал сам по себе, а терялся человек на стыке — в том,
 * что именно уезжает на сервер с устройства, у которого ничего нет.
 */

const SERVER_TIME = '2026-02-01T10:00:00.000Z';

interface PushBody {
	changes: Record<string, unknown[]>;
	settings?: Record<string, unknown>;
	settingsUpdatedAt?: string;
}

let pushes: PushBody[] = [];
let pullUrls: string[] = [];
let serverChanges: Record<string, unknown[]> = {};
let serverSettings: { settings: unknown; settingsUpdatedAt: string } | null = null;

const realFetch = globalThis.fetch;

/** localStorage в Node нет, а без него водяные знаки не проверить. */
class MemoryStorage {
	#data = new Map<string, string>();

	getItem(key: string): string | null {
		return this.#data.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.#data.set(key, String(value));
	}

	removeItem(key: string): void {
		this.#data.delete(key);
	}

	clear(): void {
		this.#data.clear();
	}
}

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		headers: { 'content-type': 'application/json' }
	});
}

function stubFetch(): void {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);

		if (url.startsWith('/api/sync/push')) {
			pushes.push(JSON.parse(String(init?.body)) as PushBody);
			return jsonResponse({ applied: {}, serverTime: SERVER_TIME });
		}

		if (url.startsWith('/api/sync/pull')) {
			pullUrls.push(url);
			return jsonResponse({
				changes: serverChanges,
				serverTime: SERVER_TIME,
				settings: serverSettings?.settings ?? null,
				settingsUpdatedAt: serverSettings?.settingsUpdatedAt ?? null
			});
		}

		throw new Error(`неожиданный запрос: ${url}`);
	}) as typeof fetch;
}

function writeWatermark(pulledAt: string): void {
	localStorage.setItem(
		'flux-planner:sync-watermark',
		JSON.stringify({ pulledAt, pushedAt: pulledAt })
	);
}

let queue: SyncQueue;

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();

	pushes = [];
	pullUrls = [];
	serverChanges = {};
	serverSettings = null;

	globalThis.localStorage = new MemoryStorage() as unknown as Storage;
	stubFetch();

	// Внутри Telegram: без подписи очередь молчит, и проверять было бы нечего.
	telegram.isEmbedded = true;
	telegram.webApp = { initData: 'auth_date=1&hash=подпись' } as unknown as TelegramWebApp;

	// Стор — синглтон: память приводится к состоянию пустого устройства.
	await plannerStore.rehydrate();

	queue = new SyncQueue();
});

afterEach(() => {
	queue.dispose();
	plannerStore.dispose();
	telegram.isEmbedded = false;
	telegram.webApp = null;
	globalThis.fetch = realFetch;
});

describe('устройство без данных', () => {
	it('не отправляет нетронутые настройки', async () => {
		await queue.syncNow();

		// Значения по умолчанию — не правка человека. Уехав с отметкой «сейчас»,
		// они затирали на сервере анкету, цели и пройденный первый запуск.
		expect(pushes).toHaveLength(1);
		expect(pushes[0].settings).toBeUndefined();
		expect(pushes[0].settingsUpdatedAt).toBeUndefined();
	});

	it('забирает всё, даже когда водяной знак остался', async () => {
		// Знак лежит в localStorage и переживает чистку IndexedDB по отдельности.
		writeWatermark('2026-01-20T10:00:00.000Z');

		await queue.syncNow();

		expect(pullUrls).toEqual(['/api/sync/pull']);
	});

	it('принимает настройки сервера поверх умолчаний', async () => {
		serverSettings = {
			settings: { calorieGoal: 2460, onboardedAt: '2026-01-10T08:00:00.000Z' },
			settingsUpdatedAt: '2026-01-10T08:00:00.000Z'
		};

		await queue.syncNow();

		expect(plannerStore.doc.settings.onboardedAt).toBe('2026-01-10T08:00:00.000Z');
		expect(plannerStore.doc.settings.calorieGoal).toBe(2460);
	});

	it('принимает записи сервера в хранилище', async () => {
		serverChanges = {
			food: [
				{
					id: 'f1',
					date: '2026-02-01',
					name: 'Овсянка',
					calories: 420,
					protein: 14,
					fat: 9,
					carbs: 68,
					source: 'manual',
					createdAt: '2026-01-31T08:00:00.000Z',
					updatedAt: '2026-01-31T08:00:00.000Z',
					deletedAt: null
				}
			]
		};

		await queue.syncNow();

		expect((await loadPlannerState()).foodEntries.map((entry) => entry.name)).toEqual(['Овсянка']);
	});
});

describe('устройство с данными', () => {
	it('отправляет настройки, которые правил человек', async () => {
		plannerStore.updateSettings({ calorieGoal: 1700 });
		await plannerStore.flush();

		await queue.syncNow();

		expect(pushes[0].settings?.calorieGoal).toBe(1700);
		expect(pushes[0].settingsUpdatedAt).toBeTypeOf('string');
	});

	it('водяной знак учитывается, когда документ на месте', async () => {
		await savePlannerDocument(createDefaultDocument());
		writeWatermark('2026-01-20T10:00:00.000Z');

		await queue.syncNow();

		expect(pullUrls[0]).toContain('since=2026-01-20');
	});
});
