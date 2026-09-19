import type { FinanceCategory, FinanceEntry, FinanceEntryType } from '$lib/types/finance';
import { addDays, type DateKey } from './date';

/**
 * Частые траты и доходы.
 *
 * Та же мысль, что и с едой: человек тратит на одно и то же. Кофе, метро,
 * обед — три записи в день, каждая из трёх действий. Подсказка из истории
 * превращает их в одно нажатие и не требует вести список «шаблонов»,
 * который всё равно никто не ведёт.
 */

export interface FrequentFinance {
	/** Заметка, если она была: «Кофе». Иначе название категории задаёт интерфейс. */
	note?: string;
	category: FinanceCategory;
	amount: number;
	count: number;
	lastDate: DateKey;
}

export interface FrequentFinanceOptions {
	end: DateKey;
	days?: number;
	limit?: number;
	type?: FinanceEntryType;
}

function key(entry: FinanceEntry): string {
	return `${entry.category}:${(entry.note ?? '').trim().toLowerCase()}`;
}

export function frequentFinance(
	entries: FinanceEntry[],
	options: FrequentFinanceOptions
): FrequentFinance[] {
	const { end, days = 30, limit = 5, type = 'expense' } = options;
	const from = addDays(end, -Math.max(1, days) + 1);

	const groups = new Map<string, FrequentFinance>();

	for (const entry of entries) {
		if (entry.type !== type) continue;
		if (entry.date < from || entry.date > end) continue;
		if (!Number.isFinite(entry.amount) || entry.amount <= 0) continue;

		const id = key(entry);
		const existing = groups.get(id);

		if (!existing) {
			groups.set(id, {
				note: entry.note?.trim() || undefined,
				category: entry.category,
				amount: entry.amount,
				count: 1,
				lastDate: entry.date
			});
			continue;
		}

		existing.count += 1;

		// Сумма берётся из последней записи: кофе дорожает, и подставлять
		// прошлогоднюю цену значит заставлять править её каждый раз.
		if (entry.date >= existing.lastDate) {
			existing.amount = entry.amount;
			existing.note = entry.note?.trim() || undefined;
			existing.lastDate = entry.date;
		}
	}

	return [...groups.values()]
		.sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))
		.slice(0, Math.max(0, limit));
}
