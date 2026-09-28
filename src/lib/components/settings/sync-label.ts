/**
 * Подписи состояния синхронизации.
 *
 * Лежат в одном месте, потому что состояние показывают два экрана:
 * корень настроек — коротко, справа в строке, и экран данных — полностью.
 * Разные слова для одного состояния на соседних экранах читались бы
 * как два разных состояния.
 */

import type { SyncStatus } from '$lib/db/syncQueue.svelte';

export const SYNC_LABEL: Record<SyncStatus, string> = {
	idle: 'Всё синхронизировано',
	syncing: 'Синхронизация…',
	offline: 'Нет сети — данные сохранены локально',
	error: 'Не удалось синхронизировать'
};

/** Полная подпись для экрана данных: без входа «всё синхронизировано» было бы неправдой. */
export function syncLabel(status: SyncStatus, authenticated: boolean): string {
	return authenticated ? SYNC_LABEL[status] : 'Только на этом устройстве';
}

/** Короткое значение для строки списка: помещается справа от подписи. */
export function syncShortLabel(status: SyncStatus, authenticated: boolean): string {
	if (!authenticated) return 'Локально';

	switch (status) {
		case 'syncing':
			return 'Обмен…';
		case 'offline':
			return 'Нет сети';
		case 'error':
			return 'Ошибка';
		default:
			return 'В порядке';
	}
}
