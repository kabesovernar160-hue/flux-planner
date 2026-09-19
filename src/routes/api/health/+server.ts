import { json } from '@sveltejs/kit';
import { getConfig, validateConfig } from '$lib/server/config';
import { pingDb } from '$lib/server/db/client';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Проверка живости для балансировщика и мониторинга.
 *
 * Отвечает только «работает ли приложение и доступна ли база». Ни версий
 * библиотек, ни значений переменных, ни адреса базы: health-эндпоинт открыт
 * наружу, и всё, что он рассказывает, рассказывается всему интернету.
 *
 * Отдаёт 503 при недоступной базе — иначе балансировщик продолжит слать
 * запросы в инстанс, который не может ответить ничем, кроме ошибок.
 */
export const GET: RequestHandler = async () => {
	const database = await pingDb();
	const config = getConfig();

	// Наружу уходит только факт «настроено/не настроено», без подробностей.
	const configured = validateConfig(config).every((problem) => problem.level !== 'fatal');

	const status = database && configured ? 200 : 503;

	return json(
		{
			status: status === 200 ? 'ok' : 'degraded',
			database,
			configured,
			time: new Date().toISOString()
		},
		{ status, headers: { 'cache-control': 'no-store' } }
	);
};
