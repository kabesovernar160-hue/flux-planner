import { telegram } from '$lib/telegram';
import { authHeaders } from '$lib/telegram/auth';
import type { ServiceResult } from './nutritionService';

/**
 * Ключ быстрой записи с телефона.
 *
 * Работает только внутри Telegram: выдать ключ может лишь тот, кого сервер
 * опознал по подписи. Сам ключ потом живёт в «Быстрой команде» на телефоне
 * и Telegram ему больше не нужен — в этом весь смысл.
 */

export interface CaptureTokenState {
	exists: boolean;
	createdAt?: string;
	lastUsedAt?: string | null;
}

function offline(): ServiceResult<never> {
	return {
		ok: false,
		errors: { auth: 'Ключ выдаётся внутри Telegram: сервер отвечает только по подписи' }
	};
}

async function call<T>(method: string): Promise<ServiceResult<T>> {
	if (!telegram.isEmbedded || !telegram.initData) return offline();

	try {
		const response = await fetch('/api/capture/token', {
			method,
			headers: authHeaders({ 'content-type': 'application/json' })
		});

		if (!response.ok) {
			const payload = (await response.json().catch(() => null)) as {
				error?: { message?: string };
			} | null;

			return { ok: false, errors: { server: payload?.error?.message ?? 'Не удалось выполнить' } };
		}

		return { ok: true, value: (await response.json()) as T };
	} catch {
		return { ok: false, errors: { network: 'Нет связи с сервером. Попробуйте позже' } };
	}
}

export function loadCaptureToken(): Promise<ServiceResult<CaptureTokenState>> {
	return call<CaptureTokenState>('GET');
}

/** Выдаёт новый ключ и отзывает прежний. Показать его можно только сейчас. */
export function issueCaptureToken(): Promise<ServiceResult<{ token: string; createdAt: string }>> {
	return call<{ token: string; createdAt: string }>('POST');
}

export function revokeCaptureToken(): Promise<ServiceResult<{ revoked: number }>> {
	return call<{ revoked: number }>('DELETE');
}

/** Адрес, который вставляется в «Быструю команду». */
export function captureUrl(): string {
	return `${location.origin}/api/capture`;
}
