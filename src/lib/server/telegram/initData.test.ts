import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData, type InitDataResult } from './initData';

/** Причина отказа. Сужает объединение, чтобы тесты читались одной строкой. */
const reasonOf = (result: InitDataResult) => (result.ok ? null : result.reason);
const okOf = (result: InitDataResult) => result.ok;

const TOKEN = '8585094426:TEST-TOKEN-NOT-REAL';
const NOW = new Date('2026-01-15T12:00:00.000Z');
const AUTH_DATE = String(Math.floor(NOW.getTime() / 1000));

const USER = JSON.stringify({
	id: 4242,
	first_name: 'Александр',
	username: 'alex',
	language_code: 'ru',
	is_premium: true
});

const sign = (overrides: Record<string, string> = {}, token = TOKEN) =>
	signInitData({ auth_date: AUTH_DATE, user: USER, ...overrides }, token);

describe('validateInitData', () => {
	it('принимает корректно подписанную строку', () => {
		const result = validateInitData(sign(), TOKEN, { now: NOW });

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.data.user.id).toBe(4242);
		expect(result.data.user.firstName).toBe('Александр');
		expect(result.data.user.username).toBe('alex');
		expect(result.data.user.isPremium).toBe(true);
	});

	it('отвергает подпись, сделанную другим токеном', () => {
		const foreign = sign({}, 'другой-токен');
		expect(reasonOf(validateInitData(foreign, TOKEN, { now: NOW }))).toBe('BAD_SIGNATURE');
	});

	it('отвергает подменённый идентификатор пользователя', () => {
		// Ключевой сценарий: клиент правит user и оставляет старую подпись.
		const params = new URLSearchParams(sign());
		params.set('user', JSON.stringify({ id: 999999, first_name: 'Чужой' }));

		expect(reasonOf(validateInitData(params.toString(), TOKEN, { now: NOW }))).toBe(
			'BAD_SIGNATURE'
		);
	});

	it('отвергает добавленное постороннее поле', () => {
		const params = new URLSearchParams(sign());
		params.set('is_admin', 'true');

		expect(okOf(validateInitData(params.toString(), TOKEN, { now: NOW }))).toBe(false);
	});

	it('отвергает строку без подписи', () => {
		const unsigned = `auth_date=${AUTH_DATE}&user=${encodeURIComponent(USER)}`;
		expect(reasonOf(validateInitData(unsigned, TOKEN, { now: NOW }))).toBe('MISSING_HASH');
	});

	it('отвергает подпись не-hex строкой', () => {
		const params = new URLSearchParams(sign());
		params.set('hash', 'z'.repeat(64));
		expect(okOf(validateInitData(params.toString(), TOKEN, { now: NOW }))).toBe(false);
	});

	it('отвергает пустой ввод', () => {
		expect(reasonOf(validateInitData('', TOKEN))).toBe('EMPTY');
		expect(reasonOf(validateInitData(sign(), ''))).toBe('EMPTY');
	});

	it('отвергает просроченную подпись', () => {
		// Без проверки давности перехваченная строка работала бы вечно.
		const later = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
		expect(reasonOf(validateInitData(sign(), TOKEN, { now: later }))).toBe('EXPIRED');
	});

	it('принимает подпись в пределах срока годности', () => {
		const later = new Date(NOW.getTime() + 23 * 60 * 60 * 1000);
		expect(okOf(validateInitData(sign(), TOKEN, { now: later }))).toBe(true);
	});

	it('срок годности настраивается', () => {
		const later = new Date(NOW.getTime() + 2 * 60 * 1000);
		expect(okOf(validateInitData(sign(), TOKEN, { now: later, maxAgeSeconds: 60 }))).toBe(false);
	});

	it('отвергает дату из будущего', () => {
		const earlier = new Date(NOW.getTime() - 60 * 60 * 1000);
		expect(reasonOf(validateInitData(sign(), TOKEN, { now: earlier }))).toBe('EXPIRED');
	});

	it('допускает небольшое расхождение часов', () => {
		const slightlyEarlier = new Date(NOW.getTime() - 60 * 1000);
		expect(okOf(validateInitData(sign(), TOKEN, { now: slightlyEarlier }))).toBe(true);
	});

	it('отвергает строку без пользователя', () => {
		const signed = signInitData({ auth_date: AUTH_DATE }, TOKEN);
		expect(reasonOf(validateInitData(signed, TOKEN, { now: NOW }))).toBe('MISSING_USER');
	});

	it('отвергает пользователя без числового id', () => {
		const signed = sign({ user: JSON.stringify({ first_name: 'Без id' }) });
		expect(reasonOf(validateInitData(signed, TOKEN, { now: NOW }))).toBe('MISSING_USER');
	});

	it('отвергает нечитаемый JSON пользователя', () => {
		const signed = sign({ user: 'не json' });
		expect(reasonOf(validateInitData(signed, TOKEN, { now: NOW }))).toBe('MISSING_USER');
	});

	it('отвергает некорректный auth_date', () => {
		const signed = signInitData({ auth_date: 'вчера', user: USER }, TOKEN);
		expect(reasonOf(validateInitData(signed, TOKEN, { now: NOW }))).toBe('MALFORMED');
	});

	it('пробрасывает query_id и start_param', () => {
		const signed = sign({ query_id: 'AAH123', start_param: 'ref42' });
		const result = validateInitData(signed, TOKEN, { now: NOW });

		expect(result.ok && result.data.queryId).toBe('AAH123');
		expect(result.ok && result.data.startParam).toBe('ref42');
	});

	it('порядок полей в строке не влияет на результат', () => {
		// Подписывается отсортированная строка, поэтому порядок в запросе свободный.
		const params = new URLSearchParams(sign());
		const reversed = new URLSearchParams([...params.entries()].reverse());

		expect(okOf(validateInitData(reversed.toString(), TOKEN, { now: NOW }))).toBe(true);
	});
});
