/**
 * Признаки первого запуска.
 *
 * Считаются по самим записям, а не по отдельному флагу: флаг пришлось бы
 * держать в согласии с данными, и удалённая с другого устройства последняя
 * запись оставила бы его врать.
 */

type Stamped = { createdAt: string };

export type RecordCollections = {
	foodEntries: Stamped[];
	habits: Stamped[];
	financeEntries: Stamped[];
	planItems: Stamped[];
	weightEntries: Stamped[];
};

function collections(data: RecordCollections): Stamped[][] {
	return [data.foodEntries, data.habits, data.financeEntries, data.planItems, data.weightEntries];
}

/**
 * Есть ли хоть одна запись.
 *
 * Вода и цели дня не в счёт: они живут в записи дня, которая создаётся
 * и без участия человека, — например, из анкеты. Отметки привычек тоже:
 * без самой привычки их не бывает.
 */
export function hasAnyRecords(data: RecordCollections): boolean {
	return collections(data).some((rows) => rows.length > 0);
}

/**
 * Сделал ли человек запись после указанного момента.
 *
 * Нужна, чтобы отличить первое действие от данных, приехавших
 * синхронизацией: у пришедших с сервера записей время создания старое.
 * Строки ISO в UTC сравниваются лексикографически так же, как даты.
 */
export function hasRecordSince(data: RecordCollections, since: string): boolean {
	return collections(data).some((rows) => rows.some((row) => row.createdAt >= since));
}
