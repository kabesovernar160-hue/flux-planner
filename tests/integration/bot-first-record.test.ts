import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getReadyDb, resetDbForTests } from '$lib/server/db/client';
import { financeEntries, foodEntries, referrals, users } from '$lib/server/db/schema';
import { getOrCreateReferralCode } from '$lib/server/referrals/referrals';
import {
	FIRST_RECORD_LINE,
	OPEN_APP_BUTTON,
	OPEN_DAY_BUTTON,
	TRY_EXAMPLES,
	WELCOME_TEXT
} from '$lib/server/telegram/botMessages';
import { parseIntentLocally } from '$lib/server/ai/providers/mockIntent';

/**
 * Первая запись прямо в чате: /start → пример → запись → «Открыть мой день».
 *
 * Сеть подменена: Bot API — шпионом, разбор — правилами без модели. Главное,
 * что здесь проверяется, — пример под приветствием идёт в тот же разбор,
 * что и набранное руками сообщение, а не в свой отдельный путь.
 */

const bot = vi.hoisted(() => ({
	sendMessage: vi.fn(async (..._args: unknown[]) => undefined),
	answerCallbackQuery: vi.fn(async (..._args: unknown[]) => undefined),
	editMessageReplyMarkup: vi.fn(async (..._args: unknown[]) => undefined)
}));

const parseIntent = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/telegram/botApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/telegram/botApi')>()),
	...bot
}));

vi.mock('$lib/server/ai/intentProvider', () => ({
	resolveIntentProvider: () => ({ name: 'test', parseIntent })
}));

const { POST } = await import('../../src/routes/api/telegram/webhook/+server');

const SECRET = 'webhook-secret';
const APP_URL = 'https://flux.example.com';
const TOKEN = '8585094426:TEST-TOKEN-NOT-REAL';

beforeAll(() => {
	process.env.DATABASE_URL = ':memory:';
	process.env.TELEGRAM_BOT_TOKEN = TOKEN;
	process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
	process.env.TELEGRAM_MINI_APP_URL = APP_URL;
});

beforeEach(() => {
	resetDbForTests();
	vi.clearAllMocks();
	parseIntent.mockImplementation(async (text: string) => parseIntentLocally(text));
});

async function deliver(update: unknown): Promise<void> {
	const response = await POST({
		request: new Request('http://localhost/api/telegram/webhook', {
			method: 'POST',
			headers: { 'x-telegram-bot-api-secret-token': SECRET, 'content-type': 'application/json' },
			body: JSON.stringify(update)
		})
	} as never);

	expect(response.status).toBe(200);
}

const from = (id: number) => ({ id, first_name: 'Аня' });

function message(id: number, text: string) {
	return { message: { message_id: 1, chat: { id }, from: from(id), text } };
}

function tap(id: number, data: string) {
	return {
		callback_query: {
			id: 'cb-1',
			data,
			from: from(id),
			message: { message_id: 2, chat: { id } }
		}
	};
}

type Markup = { inline_keyboard: { text: string; callback_data?: string; web_app?: unknown }[][] };

function lastReply(): { text: string; markup?: Markup } {
	const call = bot.sendMessage.mock.calls.at(-1) as [number, string, { replyMarkup?: Markup }?];
	return { text: call[1], markup: call[2]?.replyMarkup };
}

const buttonTexts = (markup?: Markup) => markup?.inline_keyboard.flat().map((b) => b.text) ?? [];

describe('первая запись из чата', () => {
	it('/start заводит человека и показывает примеры с кнопкой приложения', async () => {
		await deliver(message(100, '/start'));

		const reply = lastReply();
		expect(reply.text).toBe(WELCOME_TEXT);

		const callbacks = reply.markup?.inline_keyboard.flat().map((b) => b.callback_data);
		expect(callbacks).toEqual(expect.arrayContaining(['try:0', 'try:1', 'try:2']));
		expect(buttonTexts(reply.markup)).toContain(OPEN_APP_BUTTON);

		const db = await getReadyDb();
		const rows = await db.select().from(users).where(eq(users.telegramUserId, '100'));
		expect(rows).toHaveLength(1);
	});

	it('пример записывается тем же разбором, что и набранный текст', async () => {
		await deliver(message(100, '/start'));
		await deliver(tap(100, 'try:0'));

		expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cb-1');
		expect(parseIntent).toHaveBeenCalledTimes(1);
		expect(parseIntent).toHaveBeenLastCalledWith(TRY_EXAMPLES[0]);

		await deliver(message(100, TRY_EXAMPLES[0]));

		// Тот же вход разбора и с тем же текстом — путь один.
		expect(parseIntent).toHaveBeenCalledTimes(2);
		expect(parseIntent).toHaveBeenLastCalledWith(TRY_EXAMPLES[0]);

		const db = await getReadyDb();
		const food = await db.select().from(foodEntries);
		expect(food).toHaveLength(2);
		expect(food.every((row) => row.name === 'Борщ' && row.calories === 450)).toBe(true);
	});

	it('после самой первой записи — строка и кнопка «Открыть мой день», дальше — нет', async () => {
		await deliver(tap(100, 'try:1'));

		const first = lastReply();
		expect(first.text).toContain('Записал.');
		expect(first.text).toContain(FIRST_RECORD_LINE);
		expect(buttonTexts(first.markup)).toContain(OPEN_DAY_BUTTON);
		// Отмена никуда не делась.
		expect(buttonTexts(first.markup)).toContain('✖️ Отменить');

		const db = await getReadyDb();
		const [expense] = await db.select().from(financeEntries);
		expect(expense).toMatchObject({ type: 'expense', amount: 300 });

		await deliver(message(100, 'ужин в 19:00'));

		const second = lastReply();
		expect(second.text).not.toContain(FIRST_RECORD_LINE);
		expect(buttonTexts(second.markup)).not.toContain(OPEN_DAY_BUTTON);
	});

	it('вес из чата тоже считается первой записью', async () => {
		await deliver(message(100, 'вес 78,4'));

		expect(lastReply().text).toContain(FIRST_RECORD_LINE);
	});

	it('устаревший пример ничего не записывает', async () => {
		await deliver(tap(100, 'try:42'));

		expect(parseIntent).not.toHaveBeenCalled();
		expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cb-1');
	});
});

describe('/start с меткой', () => {
	it('/start ref_<код> приглашает нового человека, как и вход по ссылке', async () => {
		await deliver(message(100, '/start'));
		const db = await getReadyDb();
		const [inviter] = await db.select().from(users).where(eq(users.telegramUserId, '100'));
		const code = await getOrCreateReferralCode(db, inviter.id);

		await deliver(message(200, `/start ref_${code}`));

		const [friend] = await db.select().from(users).where(eq(users.telegramUserId, '200'));
		const [row] = await db.select().from(referrals).where(eq(referrals.inviteeId, friend.id));
		expect(row?.status).toBe('pending');
		expect(lastReply().text).toBe(WELCOME_TEXT);
	});

	it('давнего пользователя повторный /start ref_ приглашённым не делает', async () => {
		await deliver(message(100, '/start'));
		await deliver(message(200, '/start'));
		const db = await getReadyDb();
		const [inviter] = await db.select().from(users).where(eq(users.telegramUserId, '100'));
		const code = await getOrCreateReferralCode(db, inviter.id);

		await deliver(message(200, `/start ref_${code}`));

		expect(await db.select().from(referrals)).toHaveLength(0);
	});

	it('/start tiktok — просто приветствие', async () => {
		await deliver(message(300, '/start tiktok'));

		expect(lastReply().text).toBe(WELCOME_TEXT);
		const db = await getReadyDb();
		expect(await db.select().from(referrals)).toHaveLength(0);
	});
});
