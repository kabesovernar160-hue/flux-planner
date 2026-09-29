import { mergeSettingsFromSync } from '$lib/db/localDb';
import { syncQueue } from '$lib/db/syncQueue.svelte';
import { authMode } from '$lib/state/authMode.svelte';
import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { telegram } from '$lib/telegram';
import { authHeaders } from '$lib/telegram/auth';

/**
 * Серверная сессия приложения.
 *
 * Пользователь считается авторизованным только после того, как сервер
 * проверил его и ответил. То, что в initDataUnsafe лежит объект user,
 * не значит ничего: строку запуска подделать тривиально, и решение об
 * авторизации принимает исключительно сервер.
 *
 * Внутри Telegram сервер проверяет подпись initData. Вне Telegram —
 * приложение на главном экране телефона или вкладка браузера — сессию
 * устройства (кука после кода из бота). Без неё статус 'signedOut',
 * и разметка показывает экран входа. 'local' — человек сам выбрал
 * «Пользоваться без входа»: всё работает, но без облака.
 */
export type SessionStatus =
	'idle' | 'authenticating' | 'authenticated' | 'local' | 'signedOut' | 'error';

/** Чем выполнен вход: подписью Telegram или сессией устройства. */
export type SessionKind = 'telegram' | 'device';

export interface SessionUser {
	id: string;
	telegramUserId: string;
	firstName?: string | null;
	username?: string | null;
	timezone: string;
}

export interface AuthPayload {
	user: SessionUser;
	state?: { settings: unknown; settingsUpdatedAt: string | null } | null;
	admin?: boolean;
}

class SessionState {
	status = $state<SessionStatus>('idle');
	kind = $state<SessionKind | null>(null);
	user = $state<SessionUser | null>(null);
	error = $state<string | null>(null);
	/**
	 * Показывать ли строку «Статистика». Это подсказка интерфейсу,
	 * а не доступ: сервер отвечает на /api/admin/stats по своему списку.
	 */
	isAdmin = $state(false);

	/**
	 * Известно ли, что сервер помнит об этом человеке.
	 *
	 * Без входа по своей воле — сразу: спрашивать некого, других устройств нет.
	 * Иначе — только после ответа сервера, даже если ответ «ничего нет».
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
		if (telegram.isEmbedded && telegram.initData) {
			await this.#authenticate('/api/auth/telegram', 'telegram');
			return;
		}

		if (authMode.localOnly && !authMode.device) {
			this.status = 'local';
			this.profileKnown = true;
			return;
		}

		await this.#authenticate('/api/auth/session', 'device');
	}

	async #authenticate(endpoint: string, kind: SessionKind): Promise<void> {
		this.status = 'authenticating';
		this.error = null;

		try {
			const response = await fetch(endpoint, { method: 'POST', headers: authHeaders() });

			if (kind === 'device' && response.status === 401) {
				// Куки нет, она отозвана или протухла. Отметка входа больше
				// не правда: без неё синхронизация замолчит, а разметка
				// покажет экран входа.
				authMode.setDevice(false);
				this.status = 'signedOut';
				return;
			}

			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				this.error = payload?.error?.message ?? 'Не удалось выполнить вход';
				this.status = 'error';
				return;
			}

			await this.#apply((await response.json()) as AuthPayload, kind);
		} catch {
			// Сети нет. Это не повод блокировать приложение: локальные данные
			// доступны, а вход повторится при следующем открытии. На телефоне
			// без Telegram так же — если вход здесь уже был; иначе экран входа.
			if (kind === 'device' && !authMode.device) {
				this.status = 'signedOut';
				return;
			}

			this.error = 'Нет связи с сервером';
			this.status = 'error';
			this.kind = kind;
			if (kind === 'device') this.profileKnown = true;
		}
	}

	/**
	 * Вход на устройстве по коду из бота — ответ уже получен страницей входа.
	 *
	 * Если на устройстве лежат данные другого человека (телефон передали,
	 * вошли в другой аккаунт), они стираются до первой синхронизации:
	 * иначе очередь отправила бы чужой дневник в новый аккаунт. Данные,
	 * записанные без входа, остаются и уезжают в аккаунт — ради этого
	 * человек обычно и входит.
	 */
	async adoptDevice(payload: AuthPayload): Promise<void> {
		await plannerStore.initialize();

		const localOwner = plannerStore.doc.user.telegramUserId;
		if (localOwner && localOwner !== payload.user.telegramUserId) {
			syncQueue.forget();
			await plannerStore.reset();
		}

		authMode.setDevice(true);
		await this.#apply(payload, 'device');
		void syncQueue.syncNow();
	}

	/**
	 * Выход с этого устройства или со всех.
	 *
	 * Локальные данные стираются вместе с сессией: выход на общем телефоне
	 * должен уносить дневник с собой, а не оставлять следующему. На сервере
	 * всё остаётся — войдёте снова, и синхронизация вернёт.
	 */
	async signOut(options: { all?: boolean } = {}): Promise<boolean> {
		try {
			const response = await fetch('/api/auth/logout', {
				method: 'POST',
				headers: authHeaders({ 'content-type': 'application/json' }),
				body: JSON.stringify({ all: options.all === true })
			});
			if (!response.ok) return false;
		} catch {
			return false;
		}

		// Внутри Telegram «выйти везде» отзывает телефоны, а сам Mini App
		// остаётся на подписи клиента — выходить из него нечем.
		if (this.kind === 'telegram') return true;

		authMode.setDevice(false);
		syncQueue.forget();
		await plannerStore.reset();

		this.user = null;
		this.kind = null;
		this.isAdmin = false;
		this.profileKnown = false;
		this.status = 'signedOut';
		return true;
	}

	/** «Пользоваться без входа»: только локальные данные, экран входа не навязывается. */
	continueLocally(): void {
		authMode.setLocalOnly(true);
		this.status = 'local';
		this.profileKnown = true;
	}

	async #apply(payload: AuthPayload, kind: SessionKind): Promise<void> {
		this.user = payload.user;
		this.kind = kind;
		this.isAdmin = payload.admin === true;
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
