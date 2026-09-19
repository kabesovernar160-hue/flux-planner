import { describe, expect, it } from 'vitest';
import type { FoodScanResult } from '$lib/types/nutrition';
import {
	confirmScanKeyboard,
	formatSavedMessage,
	formatScanMessage,
	isValidMiniAppUrl,
	miniAppKeyboard,
	OPEN_APP_BUTTON,
	WELCOME_TEXT
} from './botMessages';

const result: FoodScanResult = {
	items: [
		{
			id: '1',
			name: 'Куриная грудка',
			estimatedGrams: 150,
			calories: 248,
			protein: 46.5,
			fat: 5.4,
			carbs: 0,
			per100g: { calories: 165, protein: 31, fat: 3.6, carbs: 0 },
			nutritionSource: 'database',
			confidence: 0.85
		},
		{
			id: '2',
			name: 'Рис отварной',
			estimatedGrams: 200,
			calories: 260,
			protein: 5.4,
			fat: 0.6,
			carbs: 56,
			per100g: { calories: 130, protein: 2.7, fat: 0.3, carbs: 28 },
			nutritionSource: 'database',
			confidence: 0.8
		}
	],
	totals: { calories: 508, protein: 51.9, fat: 6, carbs: 56 },
	overallConfidence: 0.82
};

describe('приветствие', () => {
	it('содержит название приложения и приглашение открыть его', () => {
		expect(WELCOME_TEXT).toContain('Flux Planner');
		expect(WELCOME_TEXT).toContain('Открой приложение');
	});
});

describe('isValidMiniAppUrl', () => {
	it('принимает только https', () => {
		expect(isValidMiniAppUrl('https://app.example.com')).toBe(true);
		expect(isValidMiniAppUrl('http://app.example.com')).toBe(false);
		expect(isValidMiniAppUrl('localhost:5173')).toBe(false);
		expect(isValidMiniAppUrl(undefined)).toBe(false);
		expect(isValidMiniAppUrl('')).toBe(false);
	});
});

describe('miniAppKeyboard', () => {
	it('делает кнопку запуска Mini App', () => {
		const keyboard = miniAppKeyboard('https://app.example.com');

		expect(keyboard?.inline_keyboard[0][0]).toEqual({
			text: OPEN_APP_BUTTON,
			web_app: { url: 'https://app.example.com' }
		});
	});

	it('не делает кнопку с неподходящим адресом', () => {
		// Telegram отвергает такой запрос целиком, и вместо приветствия
		// пользователь не получил бы ничего.
		expect(miniAppKeyboard('http://app.example.com')).toBeUndefined();
		expect(miniAppKeyboard(undefined)).toBeUndefined();
	});
});

describe('confirmScanKeyboard', () => {
	it('несёт идентификатор разбора в callback_data', () => {
		const keyboard = confirmScanKeyboard('scan-1', 'https://app.example.com');

		expect(keyboard.inline_keyboard[0][0].callback_data).toBe('scan:save:scan-1');
		expect(keyboard.inline_keyboard[0][1].callback_data).toBe('scan:drop:scan-1');
	});

	it('callback_data укладывается в предел Telegram в 64 байта', () => {
		const keyboard = confirmScanKeyboard('a'.repeat(30), undefined);

		for (const row of keyboard.inline_keyboard) {
			for (const button of row) {
				if (button.callback_data) {
					expect(new TextEncoder().encode(button.callback_data).length).toBeLessThanOrEqual(64);
				}
			}
		}
	});

	it('без адреса приложения оставляет только подтверждение', () => {
		const keyboard = confirmScanKeyboard('scan-1', undefined);

		expect(keyboard.inline_keyboard).toHaveLength(1);
	});
});

describe('formatScanMessage', () => {
	it('перечисляет компоненты по отдельности', () => {
		const text = formatScanMessage(result);

		expect(text).toContain('Куриная грудка — 150 г · 248 ккал');
		expect(text).toContain('Рис отварной — 200 г · 260 ккал');
		expect(text).toContain('Итого: 508 ккал');
	});

	it('прямо говорит, что в дневник ничего не записано', () => {
		// Молча записывать оценку по фотографии нельзя — об этом должно быть
		// сказано в самом сообщении, а не только в документации.
		expect(formatScanMessage(result)).toContain('ничего не записано');
	});

	it('предупреждает о низкой уверенности', () => {
		const text = formatScanMessage({ ...result, overallConfidence: 0.2 });

		expect(text).toContain('низкая');
	});
});

describe('formatSavedMessage', () => {
	it('называет записанное и итог', () => {
		const text = formatSavedMessage(result);

		expect(text).toContain('Куриная грудка, Рис отварной');
		expect(text).toContain('508 ккал');
	});
});
