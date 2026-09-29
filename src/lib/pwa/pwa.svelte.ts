import { browser, dev } from '$app/environment';

/**
 * Приложение на главном экране: установка и сервис-воркер.
 *
 * Внутри Telegram ничего из этого не нужно: у Mini App свой ярлык
 * (addToHomeScreen клиента), кеш WebView чистит сам Telegram, а воркер
 * в чужом WebView только мешал бы обновлениям. Поэтому всё здесь
 * включается только вне Telegram.
 */

/** Событие Chrome «можно установить». В lib.dom его пока нет. */
interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
	interface Window {
		/** Отложено скриптом в app.html, если пришло до монтирования. */
		__fxInstallPrompt?: BeforeInstallPromptEvent;
	}
}

export type InstallPlatform = 'ios' | 'android' | 'desktop';

function detectPlatform(): InstallPlatform {
	if (!browser) return 'desktop';
	const ua = navigator.userAgent;

	// iPadOS притворяется маком, но у мака нет сенсорного экрана.
	if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
		return 'ios';
	}
	if (/Android/.test(ua)) return 'android';
	return 'desktop';
}

function detectStandalone(): boolean {
	if (!browser) return false;
	const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
	return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

class Pwa {
	/** Открыто как приложение с главного экрана, без адресной строки. */
	standalone = $state(detectStandalone());
	platform = $state<InstallPlatform>(detectPlatform());

	/** iOS не в Safari: ставить на экран умеют не все браузеры, подсказка другая. */
	get iosOtherBrowser(): boolean {
		return (
			this.platform === 'ios' && browser && /CriOS|FxiOS|EdgiOS|YaBrowser/.test(navigator.userAgent)
		);
	}

	/** Chrome готов показать своё окно установки. */
	canPrompt = $state(false);
	/** Только что установили кнопкой — показать «готово», а не инструкцию. */
	installed = $state(false);

	#prompt: BeforeInstallPromptEvent | null = null;

	/**
	 * Запуск. embedded — открыты ли внутри Telegram.
	 *
	 * Возвращает отписку: разметка монтируется заново при HMR, и обработчики
	 * иначе копились бы.
	 */
	init(embedded: boolean): () => void {
		if (!browser) return () => {};

		if (embedded) {
			// Воркер мог остаться от прежней версии, когда регистрировал
			// сам SvelteKit, — внутри Telegram ему не место.
			void navigator.serviceWorker
				?.getRegistrations()
				.then((registrations) => registrations.forEach((item) => void item.unregister()))
				.catch(() => undefined);
			return () => {};
		}

		this.#registerWorker();

		const early = window.__fxInstallPrompt;
		if (early) this.#capture(early);

		const onPrompt = (event: Event) => {
			event.preventDefault();
			this.#capture(event as BeforeInstallPromptEvent);
		};
		const onInstalled = () => {
			this.installed = true;
			this.canPrompt = false;
			this.#prompt = null;
		};
		const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
		const onDisplayMode = () => (this.standalone = detectStandalone());

		window.addEventListener('beforeinstallprompt', onPrompt);
		window.addEventListener('appinstalled', onInstalled);
		standaloneQuery?.addEventListener?.('change', onDisplayMode);

		return () => {
			window.removeEventListener('beforeinstallprompt', onPrompt);
			window.removeEventListener('appinstalled', onInstalled);
			standaloneQuery?.removeEventListener?.('change', onDisplayMode);
		};
	}

	#capture(event: BeforeInstallPromptEvent): void {
		this.#prompt = event;
		this.canPrompt = true;
		window.__fxInstallPrompt = undefined;
	}

	#registerWorker(): void {
		if (!('serviceWorker' in navigator)) return;

		// В разработке SvelteKit отдаёт воркер ES-модулем: так его понимает
		// только Chromium, но для проверки этого достаточно.
		navigator.serviceWorker
			.register('/service-worker.js', { type: dev ? 'module' : 'classic' })
			.catch((error) => console.warn('[pwa] сервис-воркер не зарегистрирован', error));
	}

	/** Окно установки Chrome. Отказ — не ошибка: предложение просто уйдёт. */
	async install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
		const prompt = this.#prompt;
		if (!prompt) return 'unavailable';

		this.#prompt = null;
		this.canPrompt = false;

		try {
			await prompt.prompt();
			const { outcome } = await prompt.userChoice;
			if (outcome === 'accepted') this.installed = true;
			return outcome;
		} catch {
			return 'unavailable';
		}
	}
}

export const pwa = new Pwa();
