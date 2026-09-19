import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
	dailyFinance,
	dailyNutrition,
	financeEntries,
	foodEntries,
	habitCompletions,
	habits,
	pendingScans,
	planItems,
	plannerState,
	users,
	weightEntries
} from '../db/schema';

/**
 * Удаление данных учётной записи.
 *
 * Политика конфиденциальности обещает стереть данные по запросу. Обещание,
 * которое выполняется запросом в базу руками, — это не обещание, а намерение:
 * рано или поздно оно упрётся в занятый вечер.
 *
 * Записи стираются насовсем, без надгробий: надгробие нужно, чтобы удаление
 * доехало до других устройств, а здесь удаляется всё и сразу. Локальную копию
 * на устройстве стирает клиент — сервер до неё не дотянется.
 */

/**
 * Пользователь не удаляется, а обезличивается.
 *
 * Строка платежа ссылается на него и должна пережить удаление — значит,
 * сослаться ей должно быть на что. После обезличивания в учётной записи
 * не остаётся ничего, что связывало бы её с человеком: ни идентификатора
 * Telegram, ни имени, ни ника. Вход тем же аккаунтом заведёт нового
 * пользователя с чистой историей.
 */
export function anonymousTelegramId(userId: string): string {
	return `deleted:${userId}`;
}

export interface DeleteResult {
	/** Сколько строк дневника стёрто: для ответа человеку и для журнала. */
	removed: number;
}

export async function deleteAccountData(db: Db, userId: string): Promise<DeleteResult> {
	let removed = 0;

	// Одной транзакцией: полустёртая учётная запись хуже нестёртой — человек
	// считает, что данных нет, а половина осталась.
	await db.transaction(async (tx) => {
		const tables = [
			foodEntries,
			habits,
			habitCompletions,
			financeEntries,
			planItems,
			weightEntries,
			dailyNutrition,
			dailyFinance,
			pendingScans,
			plannerState
		];

		for (const table of tables) {
			const result = await tx
				.delete(table as never)
				.where(eq((table as unknown as { userId: never }).userId, userId));

			removed += result.rowsAffected ?? 0;
		}

		await tx
			.update(users)
			.set({
				telegramUserId: anonymousTelegramId(userId),
				username: null,
				firstName: null,
				updatedAt: new Date().toISOString()
			})
			.where(eq(users.id, userId));
	});

	return { removed };
}
