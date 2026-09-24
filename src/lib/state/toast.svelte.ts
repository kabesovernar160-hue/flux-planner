/**
 * Короткое сообщение внизу экрана с одним действием.
 *
 * Нужен быстрой записи еды: запись делается одним касанием, без формы
 * и без кнопки «Сохранить», и промах пальцем должен исправляться так же
 * быстро — «Отменить» рядом, пять секунд. Спрашивать «вы уверены?» перед
 * каждой записью значило бы вернуть те самые два лишних тапа.
 *
 * Сообщение одно: новое заменяет прежнее. Две очереди отмен одновременно
 * непонятно, к чему относятся.
 */

export interface ToastAction {
	label: string;
	run: () => void;
}

export interface Toast {
	id: number;
	message: string;
	action?: ToastAction;
}

/** Сколько живёт сообщение. Пять секунд — успеть заметить промах и нажать. */
export const TOAST_DURATION_MS = 5_000;

class ToastState {
	current = $state<Toast | null>(null);

	#timer: ReturnType<typeof setTimeout> | null = null;
	#seq = 0;

	show(message: string, action?: ToastAction, durationMs = TOAST_DURATION_MS): void {
		this.#clearTimer();
		const id = ++this.#seq;
		this.current = { id, message, action };
		this.#timer = setTimeout(() => {
			// Закрываем только своё: за это время могло прийти новое сообщение.
			if (this.current?.id === id) this.current = null;
		}, durationMs);
	}

	/** Выполнить действие и убрать сообщение: второй раз отменять нечего. */
	act(): void {
		const action = this.current?.action;
		this.dismiss();
		action?.run();
	}

	dismiss(): void {
		this.#clearTimer();
		this.current = null;
	}

	#clearTimer(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}
}

export const toast = new ToastState();
