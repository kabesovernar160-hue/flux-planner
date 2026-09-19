import type { ProfileInput } from '$lib/utils/goals';
import type { DailyFinance, FinanceEntry } from './finance';
import type { Habit, HabitCompletion } from './habit';
import type { DailyNutrition, FoodEntry } from './nutrition';
import type { PlanItem } from './plan';

/**
 * Версия схемы локального хранилища.
 *
 * Увеличивать при любом несовместимом изменении формы данных и добавлять
 * шаг в migrate() в $lib/db/localDb.
 */
export const SCHEMA_VERSION = 3;

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
}

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

	/** Цели по дням, ключ — YYYY-MM-DD. */
	nutrition: Record<string, DailyNutrition>;
	/** Бюджеты по дням, ключ — YYYY-MM-DD. */
	finance: Record<string, DailyFinance>;

	foodEntries: FoodEntry[];
	habits: Habit[];
	habitCompletions: HabitCompletion[];
	financeEntries: FinanceEntry[];
	/** План на день: разовые цели вроде «ужин в 19:00». */
	planItems: PlanItem[];
}

/** Singleton-документ: всё, кроме коллекций записей. */
export type PlannerDocument = Omit<
	PlannerState,
	'foodEntries' | 'habits' | 'habitCompletions' | 'financeEntries' | 'planItems'
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
