import { mergeSettingsFromSync } from '$lib/db/localDb';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { telegram } from '$lib/telegram';
import { authHeaders } from '$lib/telegram/auth';

/**
 * Серверная сессия Mini App.
 *
 * Пользователь считается авторизованным только после того, как сервер проверил
 * подпись initData и ответил. То, что в initDataUnsafe лежит объект user,
 * не значит ничего: строку запуска подделать тривиально, и решение об
 * авторизации принимает исключительно сервер.
 *
 * Вне Telegram состояние остаётся 'local': приложение полностью работает
 * локально — дневник, привычки, траты, — просто без синхронизации с облаком.
 */
export type SessionStatus = 'idle' | 'authenticating' | 'authenticated' | 'local' | 'error';

export interface SessionUser {
	id: string;
	telegramUserId: string;
	firstName?: string | null;
	username?: string | null;
	timezone: string;
}

class SessionState {
	status = $state<SessionStatus>('idle');
	user = $state<SessionUser | null>(null);
	error = $state<string | null>(null);

	/**
	 * Известно ли, что сервер помнит об этом человеке.
	 *
	 * Вне Telegram — сразу: спрашивать некого, других устройств нет.
	 * Внутри — только после ответа сервера, даже если ответ «ничего нет».
	 * До этого момента приложение не вправе считать человека новичком:
	 * пустое локальное хранилище значит лишь то, что Telegram его почистил.
	 */
	profileKnown = $state(false);

	/** Можно ли обращаться к серверным возможностям: сканеру и синхронизации. */
	get isAuthenticated(): boolean {
		return this.status === 'authenticated';
	}

	/**
	 * Текущая попытка входа.
	 *
	 * Вход вызывается из эффекта разметки, а эффект перезапускается при любом
	 * изменении состояния, от которого он зависит. Без этой защёлки получалась
	 * петля: вход → запись пользователя в стор → перезапуск эффекта → вход,
	 * и приложение долбило сервер запросами авторизации, пока не упиралось
	 * в ограничитель частоты.
	 */
	#inFlight: Promise<void> | null = null;

	authenticate(): Promise<void> {
		if (this.status === 'authenticated') return Promise.resolve();

		this.#inFlight ??= this.#run().finally(() => {
			this.#inFlight = null;
		});

		return this.#inFlight;
	}

	async #run(): Promise<void> {
		if (!telegram.isEmbedded || !telegram.initData) {
			this.status = 'local';
			this.profileKnown = true;
			return;
		}

		this.status = 'authenticating';
		this.error = null;

		try {
			const response = await fetch('/api/auth/telegram', {
				method: 'POST',
				headers: authHeaders()
			});

			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				this.error = payload?.error?.message ?? 'Не удалось выполнить вход';
				this.status = 'error';
				return;
			}

			const payload = (await response.json()) as {
				user: SessionUser;
				state?: { settings: unknown; settingsUpdatedAt: string | null } | null;
			};
			this.user = payload.user;
			this.status = 'authenticated';

			await this.#restoreSettings(payload.state);
			this.profileKnown = true;

			// Идентификатор из проверенного ответа сервера, а не из initDataUnsafe.
			const patch = {
				telegramUserId: payload.user.telegramUserId,
				firstName: payload.user.firstName ?? undefined,
				username: payload.user.username ?? undefined
			};

			// Запись только при реальном изменении. Пустая запись подняла бы
			// updatedAt, дёрнула синхронизацию и перезапустила эффект разметки
			// на ровном месте — а при повторном входе это происходило бы
			// каждый раз.
			const current = plannerStore.doc.user;
			const changed =
				current.telegramUserId !== patch.telegramUserId ||
				(current.firstName ?? undefined) !== patch.firstName ||
				(current.username ?? undefined) !== patch.username;

			if (changed) plannerStore.updateUser(patch);
		} catch {
			// Сети нет. Это не повод блокировать приложение: локальные данные
			// доступны, а вход повторится при следующем открытии.
			this.error = 'Нет связи с сервером';
			this.status = 'error';
		}
	}

	/**
	 * Настройки с сервера — в локальное хранилище.
	 *
	 * Победитель определяется той же отметкой времени, что и в синхронизации:
	 * серверная версия применяется, только если она свежее здешней. Нетронутые
	 * значения по умолчанию помечены началом эпохи и проигрывают всегда —
	 * ровно этого и хотим на устройстве с почищенным хранилищем.
	 *
	 * Гидратация дожидается намеренно: она читает хранилище, и запись до её
	 * окончания оказалась бы затёрта прочитанным ранее снимком.
	 */
	async #restoreSettings(
		state: { settings: unknown; settingsUpdatedAt: string | null } | null | undefined
	): Promise<void> {
		if (!state?.settingsUpdatedAt) return;

		try {
			await plannerStore.initialize();
			if (await mergeSettingsFromSync(state.settings, state.settingsUpdatedAt)) {
				await plannerStore.rehydrate();
			}
		} catch {
			// Хранилище недоступно: настройки приедут при первой синхронизации.
		}
	}
}

export const session = new SessionState();
