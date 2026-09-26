import { browser } from '$app/environment';
import type {
	HapticImpactStyle,
	HapticNotificationType,
	TelegramInset,
	TelegramThemeParams,
	TelegramUser,
	TelegramWebApp
} from './types';

/**
 * Цвет системного хрома Telegram по умолчанию — тёмный фон.
 * Настоящее значение берётся из токена --fx-chrome текущей темы.
 */
const FALLBACK_CHROME_COLOR = '#0D0D10';

/** HEX фона текущей темы: тот, что Telegram покажет в шапке и под окном. */
function readChromeColor(): string {
	if (!browser) return FALLBACK_CHROME_COLOR;
	const value = getComputedStyle(document.documentElement).getPropertyValue('--fx-chrome').trim();
	return /^#[0-9a-f]{6}$/i.test(value) ? value : FALLBACK_CHROME_COLOR;
}

function getWebApp(): TelegramWebApp | null {
	if (!browser) return null;
	return window.Telegram?.WebApp ?? null;
}

/**
 * Состояние сессии Telegram.
 *
 * Приложение обязано работать и вне Telegram — иначе `npm run dev`
 * в браузере превращается в чёрный экран. Когда SDK недоступен,
 * isEmbedded === false, а вся геометрия падает на CSS-фолбэки.
 */
class TelegramSession {
	webApp = $state<TelegramWebApp | null>(null);
	isReady = $state(false);
	viewportHeight = $state(0);

	/**
	 * Запущены внутри настоящего клиента Telegram, а не в браузере.
	 *
	 * Проверять наличие window.Telegram.WebApp бесполезно: скрипт
	 * telegram-web-app.js создаёт объект всегда, в том числе на обычной
	 * вкладке. Платформу клиент передаёт через хеш запуска, и вне Telegram
	 * она равна 'unknown' — это и есть надёжный признак.
	 */
	isEmbedded = $state(false);

	get user(): TelegramUser | null {
		return this.webApp?.initDataUnsafe.user ?? null;
	}

	get platform(): string {
		return this.webApp?.platform ?? 'browser';
	}

	/**
	 * Тема клиента Telegram, реактивно.
	 *
	 * Свойство WebApp.colorScheme обычное, а не реактивное: без копии
	 * в $state смена темы в клиенте не доходила бы до интерфейса.
	 * Обновляется по событию themeChanged. Какую тему показывать,
	 * решает $lib/theme — там же учитывается выбор в настройках.
	 */
	#colorScheme = $state<'light' | 'dark'>('dark');

	get colorScheme(): 'light' | 'dark' {
		return this.#colorScheme;
	}

	/** Цвет шапки, фона под окном и нижней полосы клиента. */
	#chromeColor: string | null = null;

	/**
	 * Покрасить системный хром Telegram в фон приложения.
	 *
	 * Шапка и полоса под окном рисуются клиентом, а не нами: без этого
	 * при смене темы они оставались бы прежнего цвета, и окно выглядело бы
	 * склеенным из двух приложений. Методы появились в разных версиях
	 * Bot API, поэтому каждый вызывается через проверку версии.
	 */
	setChromeColor(color: string): void {
		this.#chromeColor = color;

		const wa = getWebApp();
		if (!wa || !this.isEmbedded) return;

		const atLeast = (version: string): boolean => {
			try {
				return wa.isVersionAtLeast(version);
			} catch {
				return false;
			}
		};

		try {
			if (atLeast('6.1')) {
				wa.setHeaderColor?.(color);
				wa.setBackgroundColor?.(color);
			}
			if (atLeast('7.10')) wa.setBottomBarColor?.(color);
		} catch {
			/* старый клиент: хром останется своего цвета, это не ломает сценарий */
		}
	}

	get themeParams(): TelegramThemeParams {
		return this.webApp?.themeParams ?? {};
	}

	/**
	 * Подписанная строка для бэкенда. Проверять подпись обязательно на сервере:
	 * initDataUnsafe подделывается тривиально и годится только для отрисовки.
	 */
	get initData(): string {
		return this.webApp?.initData ?? '';
	}

	/**
	 * Примитивы тактильной отдачи — один в один с Bot API.
	 *
	 * Вызовы намеренно «тихие»: хаптика это украшение, и её отсутствие
	 * (старый клиент, десктоп, отключено в системе) не должно ломать сценарий.
	 */
	readonly haptic = {
		impact: (style: HapticImpactStyle = 'light') => safeHaptic((hf) => hf.impactOccurred(style)),
		notification: (type: HapticNotificationType) =>
			safeHaptic((hf) => hf.notificationOccurred(type)),
		selection: () => safeHaptic((hf) => hf.selectionChanged())
	};

	/**
	 * Параметр запуска.
	 *
	 * Приходит из ссылки вида t.me/бот/app?startapp=scan — по нему приложение
	 * открывается сразу на нужном экране. Значение не проверено подписью,
	 * поэтому годится только для навигации: ничего чувствительного
	 * от него зависеть не должно.
	 */
	get startParam(): string | null {
		return this.webApp?.initDataUnsafe.start_param ?? null;
	}

	/**
	 * Оплата счёта внутри Telegram.
	 *
	 * Ссылку выписывает сервер: цена и назначение платежа не должны зависеть
	 * от клиента. Здесь только показ окна оплаты и ответ о том, чем всё
	 * закончилось.
	 */
	openInvoice(url: string): Promise<'paid' | 'cancelled' | 'failed' | 'pending' | 'unsupported'> {
		const wa = getWebApp();

		return new Promise((resolve) => {
			if (!wa?.openInvoice || !this.isEmbedded) {
				resolve('unsupported');
				return;
			}

			try {
				wa.openInvoice(url, (status) => resolve(status));
			} catch {
				resolve('unsupported');
			}
		});
	}

	/**
	 * Открыть ссылку t.me: выбор чата для «Поделиться», профиль бота.
	 *
	 * Внутри Telegram — его собственным переходом, иначе ссылка ушла бы
	 * во внешний браузер. Вне Telegram — новой вкладкой: там t.me откроет
	 * веб-версию или предложит приложение.
	 */
	openTelegramLink(url: string): void {
		const wa = getWebApp();

		if (this.isEmbedded && wa?.openTelegramLink) {
			try {
				wa.openTelegramLink(url);
				return;
			} catch {
				// Старый клиент без метода — падаем на обычное открытие.
			}
		}

		window.open(url, '_blank', 'noopener');
	}

	/** Обработчик, навешенный на главную кнопку сейчас. Нужен, чтобы его снять. */
	#mainButtonHandler: (() => void) | null = null;

	/**
	 * Показать главную кнопку Telegram.
	 *
	 * Используется точечно — там, где у экрана ровно одно завершающее действие
	 * (подтверждение результата сканирования). Вешать её на каждый экран нельзя:
	 * она закрывает нижнюю часть окна и перестаёт что-либо значить.
	 *
	 * Вне Telegram вызов ничего не делает, поэтому у всех таких мест обязана
	 * оставаться обычная кнопка в интерфейсе.
	 */
	setMainButton(options: { text: string; onClick: () => void; loading?: boolean }): void {
		const button = getWebApp()?.MainButton;
		if (!button || !this.isEmbedded) return;

		try {
			this.#detachMainButton(button);

			button.setText(options.text);
			this.#mainButtonHandler = options.onClick;
			button.onClick(options.onClick);

			if (options.loading) {
				button.showProgress(false);
			} else {
				button.hideProgress();
				button.enable();
			}

			button.show();
		} catch {
			/* старый клиент — остаётся обычная кнопка в интерфейсе */
		}
	}

	hideMainButton(): void {
		const button = getWebApp()?.MainButton;
		if (!button) return;

		try {
			this.#detachMainButton(button);
			button.hideProgress();
			button.hide();
		} catch {
			/* см. выше */
		}
	}

	#detachMainButton(button: NonNullable<TelegramWebApp['MainButton']>): void {
		// Без снятия прежнего обработчика кнопка накапливает подписки,
		// и одно нажатие срабатывает столько раз, сколько экранов её показывали.
		if (this.#mainButtonHandler) button.offClick(this.#mainButtonHandler);
		this.#mainButtonHandler = null;
	}

	/**
	 * Инициализация. Возвращает функцию очистки — вызывать при размонтировании,
	 * иначе подписки на события Telegram протекут при HMR.
	 */
	init(): () => void {
		const wa = getWebApp();
		this.webApp = wa;
		this.isEmbedded = wa !== null && wa.platform !== 'unknown';

		if (!wa) {
			// Скрипт SDK не загрузился: работаем на CSS-фолбэках.
			this.isReady = true;
			return () => {};
		}

		wa.ready();
		wa.expand();

		if (!this.isEmbedded) {
			// Открыто в обычном браузере. Настраивать хром клиента и подписываться
			// на его события бессмысленно — событий не будет.
			this.isReady = true;
			return () => {};
		}

		const atLeast = (version: string): boolean => {
			try {
				return wa.isVersionAtLeast(version);
			} catch {
				return false;
			}
		};

		this.setChromeColor(this.#chromeColor ?? readChromeColor());
		if (atLeast('7.7')) {
			// Без этого свайп по вертикали внутри списка закрывает Mini App.
			wa.disableVerticalSwipes?.();
		}

		const syncColorScheme = () => {
			this.#colorScheme = wa.colorScheme === 'light' ? 'light' : 'dark';
		};
		syncColorScheme();

		const syncViewport = () => {
			this.viewportHeight = wa.viewportStableHeight || wa.viewportHeight || 0;
		};

		const writeInset = (prefix: string, inset: TelegramInset | undefined) => {
			if (!inset) return;
			const root = document.documentElement;
			root.style.setProperty(`${prefix}-top`, `${inset.top}px`);
			root.style.setProperty(`${prefix}-bottom`, `${inset.bottom}px`);
			root.style.setProperty(`${prefix}-left`, `${inset.left}px`);
			root.style.setProperty(`${prefix}-right`, `${inset.right}px`);
		};

		// Bot API 8.0+. В более старых клиентах отступы остаются нулевыми,
		// и вёрстка просто прижимается к краям — это корректная деградация.
		const syncInsets = () => {
			writeInset('--tg-safe-area-inset', wa.safeAreaInset);
			writeInset('--tg-content-safe-area-inset', wa.contentSafeAreaInset);
		};

		syncViewport();
		syncInsets();

		wa.onEvent('viewportChanged', syncViewport);
		wa.onEvent('safeAreaChanged', syncInsets);
		wa.onEvent('contentSafeAreaChanged', syncInsets);
		wa.onEvent('themeChanged', syncColorScheme);

		this.isReady = true;

		return () => {
			wa.offEvent('viewportChanged', syncViewport);
			wa.offEvent('safeAreaChanged', syncInsets);
			wa.offEvent('contentSafeAreaChanged', syncInsets);
			wa.offEvent('themeChanged', syncColorScheme);
		};
	}
}

export const telegram = new TelegramSession();

function safeHaptic(action: (hf: TelegramWebApp['HapticFeedback']) => void): void {
	const wa = getWebApp();
	if (!wa?.HapticFeedback) return;
	try {
		if (!wa.isVersionAtLeast('6.1')) return;
		action(wa.HapticFeedback);
	} catch {
		/* хаптика не критична — молча игнорируем */
	}
}

/**
 * Семантическая надстройка над telegram.haptic.
 *
 * Смысл в том, чтобы вызовы в компонентах читались как намерение
 * («тап», «успех»), а не как физический эффект. Тогда силу отдачи
 * можно перенастроить в одном месте, не трогая экраны.
 */
export const haptics = {
	/** Тап по карточке, кнопке, пункту списка. */
	tap: () => telegram.haptic.impact('light'),
	/** Заметное действие: удаление, подтверждение, drag-drop. */
	press: () => telegram.haptic.impact('medium'),
	/** Перелистывание, переключение сегментов, выбор даты. */
	select: () => telegram.haptic.selection(),
	success: () => telegram.haptic.notification('success'),
	warning: () => telegram.haptic.notification('warning'),
	error: () => telegram.haptic.notification('error')
};
