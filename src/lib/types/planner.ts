import type { FavoriteFood } from '$lib/utils/favorites';
import type { ProfileInput } from '$lib/utils/goals';
import type { DailyFinanceRecord, FinanceEntry } from './finance';
import type { Habit, HabitCompletion } from './habit';
import type { DailyNutritionRecord, FoodEntry } from './nutrition';
import type { PlanItem } from './plan';
import type { WeightEntry } from './weight';

/**
 * Версия схемы локального хранилища.
 *
 * Увеличивать при любом несовместимом изменении формы данных и добавлять
 * шаг в migrate() в $lib/db/localDb.
 */
export const SCHEMA_VERSION = 4;

export interface PlannerUser {
	/** Приходит из валидированного initData. До авторизации — null. */
	telegramUserId: string | null;
	firstName?: string;
	username?: string;
	timezone: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Анкета, по которой посчитаны цели.
 *
 * Хранится вместе с настройками и уезжает в синхронизацию: на втором
 * устройстве человек должен увидеть свои цели, а не значения по умолчанию.
 * Возраст хранится числом на момент заполнения — пересчёт целей это всё равно
 * ручное действие, и «тихо постаревшая» анкета вводила бы в заблуждение.
 */
export interface UserProfile extends ProfileInput {
	/** Когда анкету заполняли в последний раз. */
	updatedAt: string;
}

export interface NotificationSettings {
	/** Итоги дня вечером. */
	dailySummary: boolean;
}

/**
 * Значения по умолчанию для дней, у которых ещё нет собственной записи
 * DailyNutrition или DailyFinance. Это шаблон, а не факт конкретного дня.
 */
export interface PlannerSettings {
	calorieGoal: number;
	proteinGoal: number;
	fatGoal: number;
	carbsGoal: number;
	waterGoalMl: number;

	dailyBudget: number;
	currency: string;
	locale: string;

	/**
	 * Желаемый вес.
	 *
	 * Необязательный: дневник полезен и без цели, а навязанная цифра
	 * превращает его в укор. Появляется только когда человек её назвал сам.
	 */
	weightGoalKg?: number;

	/**
	 * Избранные блюда.
	 *
	 * В настройках, потому что они уже синхронизируются. Сливаются не целиком,
	 * как остальные настройки, а поштучно — см. $lib/utils/favorites. Старые
	 * версии приложения поле не знают, но и не теряют: настройки при чтении
	 * раскладываются поверх значений по умолчанию, и незнакомые ключи остаются.
	 */
	favoriteFoods?: FavoriteFood[];

	/** Анкета расчёта целей. Её может не быть: заполнение необязательно. */
	profile?: UserProfile;

	/**
	 * Уведомления в чате с ботом.
	 *
	 * Отсутствие настройки означает «включено»: у тех, кто пользовался
	 * приложением до её появления, поведение не должно молча измениться.
	 */
	notifications?: NotificationSettings;

	/**
	 * Когда пользователь прошёл или пропустил первый запуск.
	 *
	 * Отдельно от profile: анкету можно пропустить, и тогда приветствие
	 * не должно показываться снова при каждом открытии.
	 */
	onboardedAt?: string;

	/**
	 * Какие подсказки уже показаны и когда.
	 *
	 * Лежит в настройках, а не в localStorage: подсказку, закрытую на телефоне,
	 * не должно быть видно снова на планшете. Telegram к тому же чистит
	 * хранилище webview, и локальный флаг возвращал бы её после каждой чистки.
	 */
	hints?: Partial<Record<HintId, string>>;
}

/** Одноразовые подсказки интерфейса. */
export type HintId = 'createButton';

/**
 * Полное логическое состояние приложения.
 *
 * В IndexedDB оно раскладывается по разным object store: коллекции записей
 * отдельно от singleton-документа, чтобы добавление одной траты не
 * переписывало весь снимок состояния целиком.
 */
export interface PlannerState {
	schemaVersion: number;

	user: PlannerUser;
	settings: PlannerSettings;

	/**
	 * Когда настройки менялись в последний раз.
	 *
	 * Отдельно от user.updatedAt: настройки и запись пользователя меняются
	 * в разные моменты, а синхронизация решает по этой отметке, чья версия
	 * свежее. Пока здесь стояло время записи пользователя, сервер отвергал
	 * все правки целей после первой отправки — их отметка не двигалась.
	 */
	settingsUpdatedAt: string;

	/** Цели по дням, ключ — YYYY-MM-DD. */
	nutrition: Record<string, DailyNutritionRecord>;
	/** Бюджеты по дням, ключ — YYYY-MM-DD. */
	finance: Record<string, DailyFinanceRecord>;

	foodEntries: FoodEntry[];
	habits: Habit[];
	habitCompletions: HabitCompletion[];
	financeEntries: FinanceEntry[];
	/** План на день: разовые цели вроде «ужин в 19:00». */
	planItems: PlanItem[];
	/** Дневник веса: одна запись на день. */
	weightEntries: WeightEntry[];
}

/** Singleton-документ: всё, кроме коллекций записей. */
export type PlannerDocument = Omit<
	PlannerState,
	'foodEntries' | 'habits' | 'habitCompletions' | 'financeEntries' | 'planItems' | 'weightEntries'
>;

export type StoreStatus =
	/** Ещё не начинали гидратацию. */
	| 'idle'
	/** Читаем из IndexedDB. */
	| 'hydrating'
	/** Данные загружены, запись работает. */
	| 'ready'
	/** IndexedDB недоступен: работаем в памяти, изменения не переживут перезагрузку. */
	| 'memory';
