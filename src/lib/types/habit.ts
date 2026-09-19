export type HabitFrequency = 'daily' | 'weekdays' | 'custom';

export interface Habit {
	id: string;
	name: string;
	/**
	 * Ключ иконки, а не компонент.
	 *
	 * В IndexedDB кладётся структурированный клон, а функции и компоненты
	 * клонированию не поддаются. Ключ разворачивается в компонент Phosphor
	 * через реестр в $lib/icons/habit-icons.
	 */
	icon: string;

	frequency: HabitFrequency;

	/** Дни недели для frequency: 'custom'. 0 — воскресенье, 6 — суббота. */
	targetDays?: number[];

	createdAt: string;
	updatedAt: string;
	/** Надгробие. Отличается от archived: архив — состояние, удаление — конец записи. */
	deletedAt?: string | null;

	archived: boolean;
}

export interface HabitCompletion {
	id: string;
	habitId: string;
	/** YYYY-MM-DD. Вместе с habitId образует логический ключ записи. */
	date: string;
	completed: boolean;

	createdAt: string;
	updatedAt: string;
	deletedAt?: string | null;
}
