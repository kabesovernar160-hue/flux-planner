import type { ParsedIntent } from '../ai/intentSchema';
import type { Repositories } from '../db/repositories';
import { addDays, getToday, nowIso, type DateKey } from '$lib/utils/date';
import { mealForTime } from '$lib/utils/meals';
import { createId } from '$lib/utils/id';

/**
 * Запись разобранного сообщения в дневник.
 *
 * Используется ботом: в чате нет форм, и то, что человек написал словами,
 * должно оказаться в приложении без лишних шагов. Сами правила разбора
 * живут в ai/intentSchema — здесь только превращение готовой структуры
 * в строки базы.
 *
 * Ничего не додумывается: если в сообщении не было калорий, запись о еде
 * получит нули, и человек поправит их в приложении. Выдуманная калорийность
 * в дневнике хуже пустой.
 */

export type AppliedKind = 'plan' | 'food' | 'expense' | 'income';

export interface AppliedRecord {
	kind: AppliedKind;
	/** Коллекция и идентификатор: по ним работает отмена. */
	collection: 'plan' | 'food' | 'finance';
	id: string;
	title: string;
	date: DateKey;
	time?: string;
	amount?: number;
	calories?: number;
}

export interface ApplyContext {
	repositories: Repositories;
	userId: string;
	timezone: string;
	now?: Date;
}

function resolveDate(offset: number, timezone: string, now: Date): DateKey {
	const today = getToday(timezone);
	return offset === 0 ? today : addDays(today, offset);
}

/**
 * Применение разбора.
 *
 * Возвращает null для непонятых сообщений: писать в дневник «на всякий
 * случай» нельзя — человек потом будет разбираться, откуда взялась запись.
 */
export async function applyIntent(
	intent: ParsedIntent,
	context: ApplyContext
): Promise<AppliedRecord | null> {
	if (intent.kind === 'unknown' || !intent.title) return null;

	const now = context.now ?? new Date();
	const timestamp = now.toISOString();
	const date = resolveDate(intent.dayOffset, context.timezone, now);
	const id = createId();

	const base = { id, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, date };

	if (intent.kind === 'food') {
		await context.repositories.food.upsertMany(context.userId, [
			{
				...base,
				name: intent.title,
				grams: intent.grams,
				// Калории берутся только из сообщения: считать их по названию —
				// работа справочника и распознавания, а не разбора текста.
				calories: intent.calories ?? 0,
				protein: 0,
				fat: 0,
				carbs: 0,
				source: 'manual',
				// Приём берётся по времени сообщения: «съел овсянку» в девять
				// утра — завтрак. Для записи на другой день это всё равно
				// лучшая догадка, чем её отсутствие.
				meal: mealForTime(now, context.timezone)
			} as never
		]);

		return {
			kind: 'food',
			collection: 'food',
			id,
			title: intent.title,
			date,
			calories: intent.calories
		};
	}

	if (intent.kind === 'expense' || intent.kind === 'income') {
		await context.repositories.finance.upsertMany(context.userId, [
			{
				...base,
				type: intent.kind === 'income' ? 'income' : 'expense',
				amount: intent.amount ?? 0,
				// Категорию из свободного текста надёжно не вытащить,
				// поэтому нейтральная: поправить её в приложении — один тап.
				category: intent.kind === 'income' ? 'other_income' : 'other',
				note: intent.title
			} as never
		]);

		return {
			kind: intent.kind,
			collection: 'finance',
			id,
			title: intent.title,
			date,
			amount: intent.amount
		};
	}

	await context.repositories.plan.upsertMany(context.userId, [
		{
			...base,
			title: intent.title,
			time: intent.time ?? null,
			kind: guessPlanKind(intent.title),
			done: false,
			note: intent.note ?? null
		} as never
	]);

	return { kind: 'plan', collection: 'plan', id, title: intent.title, date, time: intent.time };
}

/** Приветствия, вопросы и болтовня: в дневник им не место. */
const SMALL_TALK =
	/^(привет|здравствуй|добрый день|добрый вечер|спасибо|ок|окей|ага|хорошо|как дела|ты кто|что ты умеешь)/i;

/**
 * Запасной разбор для сообщений, которых разбор не понял.
 *
 * Человек написал боту короткую фразу — он ждёт, что появится запись,
 * а не справка. Поэтому всё, что похоже на дело, становится пунктом плана,
 * даже если тип определить не удалось: поправить название проще,
 * чем заново набирать сообщение.
 *
 * Не становятся записью только приветствия, вопросы и длинные тексты —
 * там человек явно хотел не этого.
 */
export function planFallbackIntent(text: string): ParsedIntent | null {
	const trimmed = text.trim();

	if (trimmed.length === 0 || trimmed.length > 100) return null;
	if (trimmed.includes('?') || trimmed.startsWith('/')) return null;
	if (SMALL_TALK.test(trimmed)) return null;

	return {
		kind: 'plan',
		title: trimmed.charAt(0).toUpperCase() + trimmed.slice(1),
		dayOffset: 0,
		confidence: 0.3
	};
}

/**
 * Тип пункта плана по названию.
 *
 * Грубо и намеренно: тип влияет только на иконку, и ошибиться здесь
 * не страшно. Спрашивать об этом модель — лишний расход на пустом месте.
 */
function guessPlanKind(title: string): 'meal' | 'workout' | 'money' | 'task' {
	const lower = title.toLowerCase();

	if (/завтрак|обед|ужин|перекус|поесть|покушать|еда/.test(lower)) return 'meal';
	if (/трениров|зал|бег|йог|плаван|спорт|прогулк/.test(lower)) return 'workout';
	if (/оплат|плате|счёт|счет|перевод|купить/.test(lower)) return 'money';

	return 'task';
}

/**
 * Отметка пункта плана выполненным из чата.
 *
 * Тот же путь, что и в приложении: запись обновляется, отметка уезжает
 * в синхронизацию и появляется на экране.
 */
export async function markPlanDone(id: string, context: ApplyContext): Promise<boolean> {
	const rows = await context.repositories.plan.pullSince(context.userId, null);
	const existing = rows.find((row) => row.id === id) as (typeof rows)[number] | undefined;

	if (!existing) return false;

	await context.repositories.plan.upsertMany(context.userId, [
		{ ...existing, done: true, updatedAt: nowIso() } as never
	]);

	return true;
}

/**
 * Отмена записи, созданной из сообщения.
 *
 * Надгробие, а не удаление: запись могла уже уехать на устройство,
 * и без надгробия синхронизация вернула бы её обратно.
 */
export async function undoApplied(
	record: { collection: AppliedRecord['collection']; id: string },
	context: ApplyContext
): Promise<void> {
	const timestamp = (context.now ?? new Date()).toISOString();
	const repository = context.repositories[record.collection];

	const [existing] = await repository
		.pullSince(context.userId, null)
		.then((rows) => rows.filter((row) => row.id === record.id));

	if (!existing) return;

	await repository.upsertMany(context.userId, [
		{ ...existing, deletedAt: timestamp, updatedAt: nowIso() }
	]);
}
