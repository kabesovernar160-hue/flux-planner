import { json } from '@sveltejs/kit';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import {
	repositoryFor,
	SYNC_COLLECTIONS,
	type PullResponse,
	type SyncPayload
} from '$lib/server/sync/protocol';
import { SCHEMA_VERSION } from '$lib/types/planner';
import { nowIso } from '$lib/utils/date';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const limit = await checkRateLimit(`sync-pull:${getClientAddress()}`, 60, 60_000);
	if (!limit.allowed) {
		return apiError('RATE_LIMITED', 'Слишком много запросов', 429);
	}

	try {
		const { user, repositories } = await requireUser(request);

		// Пустой since означает первую синхронизацию: отдаём всё, что есть.
		const sinceRaw = url.searchParams.get('since');
		const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : null;

		// Отметку снимаем ДО чтения. Если между чтением коллекций что-то
		// запишется, оно попадёт в следующую выборку. Снимок после чтения
		// наоборот потерял бы эти записи навсегда.
		const serverTime = nowIso();

		const changes: SyncPayload = {};
		for (const collection of SYNC_COLLECTIONS) {
			changes[collection] = await repositoryFor(repositories, collection).pullSince(user.id, since);
		}

		const state = await repositories.planner.get(user.id);

		const response: PullResponse = {
			changes,
			serverTime,
			schemaVersion: state?.schemaVersion ?? SCHEMA_VERSION,
			settings: state?.settings ?? null,
			settingsUpdatedAt: state?.updatedAt ?? null
		};

		return json(response);
	} catch (error) {
		if (error instanceof AuthError) {
			return apiError(error.code, error.message, error.status);
		}

		logServerError('sync/pull', error);
		return apiError('INTERNAL', 'Не удалось получить изменения', 500);
	}
};
