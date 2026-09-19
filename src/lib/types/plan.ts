/**
 * Пункт плана на день.
 *
 * Намеренно отдельная сущность, а не привычка: привычка повторяется
 * по расписанию и живёт сериями, а план — это «сегодня в 19:00 ужин»,
 * разовая договорённость с собой. Смешать их значило бы испортить обе:
 * серии сломались бы о разовые дела, а план оброс бы расписанием,
 * которое ему не нужно.
 */
export type PlanKind = 'meal' | 'workout' | 'money' | 'task';

export interface PlanItem {
	id: string;
	/** Ключ дня YYYY-MM-DD в часовом поясе пользователя. */
	date: string;
	title: string;
	/** Время в формате HH:MM. Необязательно: не у всякой цели есть час. */
	time?: string;
	kind: PlanKind;
	done: boolean;
	/** Короткая заметка: что именно, сколько, где. */
	note?: string;

	createdAt: string;
	updatedAt: string;
	/** Надгробие. Заполнено — пункт удалён и не показывается. */
	deletedAt?: string | null;
}

export const PLAN_KINDS: PlanKind[] = ['meal', 'workout', 'money', 'task'];

export const PLAN_KIND_LABELS: Record<PlanKind, string> = {
	meal: 'Еда',
	workout: 'Тренировка',
	money: 'Деньги',
	task: 'Дело'
};
