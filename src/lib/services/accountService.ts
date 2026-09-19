import { syncQueue } from '$lib/db/syncQueue.svelte';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { telegram } from '$lib/telegram';
import { authHeaders } from '$lib/telegram/auth';
import type { ServiceResult } from './nutritionService';

/**
 * Удаление учётной записи.
 *
 * Политика конфиденциальности обещает стереть данные по запросу. Кнопка
 * честнее обещания, которое кто-то выполняет руками: занятый вечер рано
 * или поздно наступит, а обещание останется.
 *
 * Порядок важен: сначала сервер, потом устройство. Обратный порядок в случае
 * сетевой ошибки оставил бы человека с пустым экраном и живыми данными
 * на сервере — то есть с уверенностью, что всё удалено, когда это не так.
 */
export async function deleteAccount(): Promise<ServiceResult<null>> {
	if (!telegram.isEmbedded || !telegram.initData) {
		return {
			ok: false,
			errors: { auth: 'Удаление работает внутри Telegram: сервер отвечает только по подписи' }
		};
	}

	try {
		const response = await fetch('/api/account/delete', {
			method: 'POST',
			headers: authHeaders({ 'content-type': 'application/json' }),
			body: JSON.stringify({ confirm: true })
		});

		if (!response.ok) {
			const payload = (await response.json().catch(() => null)) as {
				error?: { message?: string };
			} | null;

			return {
				ok: false,
				errors: { server: payload?.error?.message ?? 'Не удалось удалить данные' }
			};
		}
	} catch {
		return { ok: false, errors: { network: 'Нет связи с сервером. Попробуйте позже' } };
	}

	// Локальная копия стирается только после ответа сервера, а водяные знаки
	// синхронизации сбрасываются вместе с ней: иначе следующий обмен считал бы,
	// что всё уже отправлено, и молчал бы про пустое устройство.
	syncQueue.forget();
	await plannerStore.reset();

	return { ok: true, value: null };
}
