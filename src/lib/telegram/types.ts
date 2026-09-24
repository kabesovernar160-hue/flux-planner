/**
 * Типы Telegram WebApp SDK — только то, что реально используется в Flux Planner.
 * Методы, появившиеся после Bot API 6.0, помечены необязательными:
 * в старых клиентах их физически нет, и обращение без проверки роняет приложение.
 */

export type HapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type HapticNotificationType = 'error' | 'success' | 'warning';

export interface TelegramHapticFeedback {
	impactOccurred(style: HapticImpactStyle): void;
	notificationOccurred(type: HapticNotificationType): void;
	selectionChanged(): void;
}

export interface TelegramUser {
	id: number;
	is_bot?: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
	language_code?: string;
	is_premium?: boolean;
	photo_url?: string;
}

export interface TelegramInitDataUnsafe {
	query_id?: string;
	user?: TelegramUser;
	auth_date?: number;
	hash?: string;
	start_param?: string;
}

export interface TelegramInset {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

/**
 * Главная кнопка клиента Telegram.
 *
 * Живёт в самом низу окна, над системной областью, и в WebView всегда
 * доступна большим пальцем. Имеет смысл там, где у экрана ровно одно
 * завершающее действие, — на остальных экранах она только отбирает место.
 */
export interface TelegramMainButton {
	text: string;
	isVisible: boolean;
	isActive: boolean;
	isProgressVisible: boolean;

	setText(text: string): void;
	show(): void;
	hide(): void;
	enable(): void;
	disable(): void;
	showProgress(leaveActive?: boolean): void;
	hideProgress(): void;
	onClick(callback: () => void): void;
	offClick(callback: () => void): void;
	/** Bot API 6.1+ */
	setParams?(params: {
		text?: string;
		color?: string;
		text_color?: string;
		is_active?: boolean;
		is_visible?: boolean;
	}): void;
}

/**
 * Параметры темы клиента.
 *
 * Flux Planner намеренно всегда тёмный: собственная палитра — часть узнаваемого
 * вида приложения, и подменять её цветами клиента значило бы получать разный
 * продукт на разных телефонах. Из темы берётся только цвет системного хрома
 * вокруг окна, чтобы стык с интерфейсом Telegram не выглядел заплаткой.
 */
export interface TelegramThemeParams {
	bg_color?: string;
	secondary_bg_color?: string;
	text_color?: string;
	hint_color?: string;
	link_color?: string;
	button_color?: string;
	button_text_color?: string;
	header_bg_color?: string;
	bottom_bar_bg_color?: string;
	accent_text_color?: string;
	destructive_text_color?: string;
}

export interface TelegramWebApp {
	/** Подписанная строка. Только её можно отдавать на бэкенд для проверки подписи. */
	initData: string;
	/** Разобранные данные БЕЗ проверки подписи. Доверять нельзя — только для отрисовки. */
	initDataUnsafe: TelegramInitDataUnsafe;

	version: string;
	platform: string;
	colorScheme: 'light' | 'dark';
	themeParams: TelegramThemeParams;

	isExpanded: boolean;
	viewportHeight: number;
	viewportStableHeight: number;

	/** Bot API 8.0+ */
	safeAreaInset?: TelegramInset;
	/** Bot API 8.0+ */
	contentSafeAreaInset?: TelegramInset;

	HapticFeedback: TelegramHapticFeedback;
	MainButton: TelegramMainButton;

	ready(): void;
	expand(): void;
	close(): void;
	isVersionAtLeast(version: string): boolean;

	/** Bot API 6.1+ */
	setHeaderColor?(color: string): void;
	/** Bot API 6.1+ */
	setBackgroundColor?(color: string): void;
	/** Bot API 7.10+ */
	setBottomBarColor?(color: string): void;

	/**
	 * Открыть ссылку t.me внутри Telegram, не закрывая Mini App.
	 *
	 * Окно «Поделиться» (t.me/share/url) открывается только так: через
	 * обычный window.open клиент ушёл бы во внешний браузер.
	 */
	openTelegramLink?(url: string): void;

	/**
	 * Bot API 6.1+ — открывает счёт прямо в приложении.
	 *
	 * Оплата звёздами проходит внутри Telegram: браузер, карта и внешний
	 * платёжный провайдер не участвуют.
	 */
	openInvoice?(
		url: string,
		callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void
	): void;

	/** Bot API 7.7+ — глушит закрытие окна свайпом вниз при скролле контента. */
	disableVerticalSwipes?(): void;
	enableVerticalSwipes?(): void;

	onEvent(eventType: string, callback: (...args: unknown[]) => void): void;
	offEvent(eventType: string, callback: (...args: unknown[]) => void): void;
}

declare global {
	interface Window {
		Telegram?: { WebApp?: TelegramWebApp };
	}
}
