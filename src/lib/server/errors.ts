import { json } from '@sveltejs/kit';

/**
 * Единый формат ошибки API.
 *
 * Наружу уходят только код и текст для человека. Стектрейсы, сообщения
 * провайдера и тем более ключи не покидают сервер: ответ об ошибке —
 * такой же канал утечки, как и успешный.
 */
export function apiError(code: string, message: string, status: number): Response {
	return json({ error: { code, message } }, { status });
}

/** Логирование причины на сервере. Наружу возвращается только безопасный текст. */
export function logServerError(scope: string, error: unknown): void {
	console.error(`[${scope}]`, error);
}
