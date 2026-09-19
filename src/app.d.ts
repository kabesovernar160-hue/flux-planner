// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			/**
			 * Идентификатор запроса из логов.
			 *
			 * Наружу отдаётся именно он, а не подробности ошибки: пользователь
			 * может назвать его поддержке, и запись найдётся за секунду.
			 */
			requestId?: string;
		}

		interface Locals {
			requestId: string;
		}

		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
