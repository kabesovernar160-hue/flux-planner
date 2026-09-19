import { json } from '@sveltejs/kit';
import { AuthError, requireUser } from '$lib/server/auth/session';
import { apiError, logServerError } from '$lib/server/errors';
import { checkRateLimit } from '$lib/server/rateLimit';
import {
	parsePushPayload,
	repositoryFor,
	SYNC_COLLECTIONS,
	type PushResponse,
	type SyncCollection
} from '$lib/server/sync/protocol';
import { SCHEMA_VERSION } from '$lib/types/planner';
import { nowIso } from '$lib/utils/date';
import type { RequestHandler } from './$types';

export const prerender = false;

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = await checkRateLimit(`sync-push:${getClientAddress()}`, 60, 60_000);
	if (!limit.allowed) {
		return apiError('RATE_LIMITED', 'Слишком много запросов', 429);
	}

	try {
		const { user, repositories } = await requireUser(request);

		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return apiError('INVALID_REQUEST', 'Ожидается JSON', 400);
		}

		const parsed = parsePushPayload(body);
		if (!parsed.ok) return apiError('VALIDATION', parsed.error, 400);

		const applied: Partial<Record<SyncCollection, number>> = {};

		for (const collection of SYNC_COLLECTIONS) {
			const rows = parsed.payload[collection];
			if (!rows || rows.length === 0) continue;

			// user.id — из проверенной подписи. Любой user_id из тела запроса
			// репозиторий перезаписывает своим значением.
			applied[collection] = await repositoryFor(repositories, collection).upsertMany(user.id, rows);
		}

		// Настройки — единственный документ, а не коллекция: у него нет
		// построчного слияния, побеждает более свежая версия целиком.
		const settings = (body as { settings?: unknown; settingsUpdatedAt?: unknown }).settings;
		const settingsUpdatedAt = (body as { settingsUpdatedAt?: unknown }).settingsUpdatedAt;

		if (settings !== undefined && typeof settingsUpdatedAt === 'string') {
			await repositories.planner.save({
				userId: user.id,
				schemaVersion: SCHEMA_VERSION,
				settings,
				updatedAt: settingsUpdatedAt
			});
		}

		const response: PushResponse = { applied, serverTime: nowIso() };
		return json(response);
	} catch (error) {
		if (error instanceof AuthError) {
			return apiError(error.code, error.message, error.status);
		}

		logServerError('sync/push', error);
		return apiError('INTERNAL', 'Не удалось сохранить изменения', 500);
	}
};
