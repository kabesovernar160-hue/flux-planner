/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';

/**
 * Сервис-воркер приложения на главном экране.
 *
 * Задача одна: приложение открывается без сети. Данные и так живут
 * в IndexedDB, а очередь синхронизации догонит сервер позже, — не хватало
 * только оболочки: HTML, скриптов, стилей и иконок.
 *
 * Правила:
 *
 * - **Запросы к API не трогаем вообще.** Ответы там личные (дневник, настройки,
 *   сессия), и кешировать их нельзя: на общем устройстве после выхода они
 *   достались бы следующему. Запросы уходят в сеть как без воркера.
 * - **Сборка и static — сначала кеш.** Файлы из _app/immutable имеют хеш
 *   в имени и не меняются; остальное привязано к версии кеша.
 * - **Страницы — сначала сеть**, без сети — сохранённая оболочка. Все
 *   страницы — одна и та же оболочка SPA, поэтому годится любая, в том
 *   числе корневая.
 * - **Кеш версионный.** Новый выкат — новый кеш, старые удаляются при
 *   активации.
 *
 * Внутри Telegram воркер не регистрируется (см. $lib/pwa).
 */

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `fx-shell-${version}`;
const SDK_CACHE = 'fx-telegram-sdk';

/** SDK Telegram в app.html грузится синхронно: без сети он держал бы запуск. */
const TELEGRAM_SDK = 'https://telegram.org/js/telegram-web-app.js';

/** Сколько ждать сеть на открытии страницы, прежде чем отдать оболочку из кеша. */
const NAVIGATION_TIMEOUT_MS = 3_000;

const PRECACHE = [...new Set([...build, ...files, ...prerendered])].filter(
	// Воркер сам себя не кеширует, а манифест иконки подтянут по ссылкам.
	(path) => !path.endsWith('/service-worker.js')
);

const PRECACHE_SET = new Set(PRECACHE);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key.startsWith('fx-shell-') && key !== CACHE)
						.map((key) => caches.delete(key))
				)
			)
			.then(() => sw.clients.claim())
	);
});

async function fromCache(request: Request | string): Promise<Response | undefined> {
	const cache = await caches.open(CACHE);
	return cache.match(request, { ignoreSearch: typeof request !== 'string' });
}

/** Оболочка для навигации: сама страница, если она есть в кеше, иначе корень. */
async function cachedShell(url: URL): Promise<Response | undefined> {
	const cache = await caches.open(CACHE);
	return (
		(await cache.match(url.pathname)) ??
		(await cache.match('/')) ??
		(await cache.match('/index.html'))
	);
}

async function navigate(request: Request, url: URL): Promise<Response> {
	const network = fetch(request);

	try {
		const response = await Promise.race([
			network,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS)
			)
		]);
		return response;
	} catch {
		const shell = await cachedShell(url);
		if (shell) return shell;
		// Кеша ещё нет (первое открытие без сети) — ждём сеть до конца.
		return network;
	}
}

async function cacheFirst(request: Request): Promise<Response> {
	const cached = await fromCache(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok && response.type === 'basic') {
		const cache = await caches.open(CACHE);
		void cache.put(request, response.clone());
	}
	return response;
}

/** SDK Telegram: из кеша сразу, обновление — фоном. */
async function staleWhileRevalidate(request: Request): Promise<Response> {
	const cache = await caches.open(SDK_CACHE);
	const cached = await cache.match(request);

	const refresh = fetch(request)
		.then((response) => {
			if (response.ok || response.type === 'opaque') void cache.put(request, response.clone());
			return response;
		})
		.catch(() => undefined);

	if (cached) return cached;
	return (await refresh) ?? new Response('', { headers: { 'content-type': 'text/javascript' } });
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	if (url.href === TELEGRAM_SDK) {
		event.respondWith(staleWhileRevalidate(request));
		return;
	}

	if (url.origin !== sw.location.origin) return;

	// Личные данные — только из сети, ни байта в кеш.
	if (url.pathname.startsWith('/api/')) return;

	if (request.mode === 'navigate') {
		event.respondWith(navigate(request, url));
		return;
	}

	if (PRECACHE_SET.has(url.pathname) || url.pathname.startsWith('/_app/immutable/')) {
		event.respondWith(cacheFirst(request));
	}
});
