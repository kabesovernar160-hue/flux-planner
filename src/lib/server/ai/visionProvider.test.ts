import { describe, expect, it } from 'vitest';
import { selectVisionProvider } from './visionProvider';
import { AiError } from './types';

describe('selectVisionProvider', () => {
	it('с ключом выбирает настоящего провайдера', () => {
		expect(selectVisionProvider({ apiKey: 'sk-test', isDev: false }).name).toBe('anthropic');
	});

	it('без ключа в разработке подставляет мок', () => {
		expect(selectVisionProvider({ isDev: true }).name).toBe('mock');
	});

	it('без ключа в продакшене отказывается работать', () => {
		// Тихо подсовывать выдуманные калории в проде нельзя: пользователь
		// занесёт их в дневник как настоящие.
		expect(() => selectVisionProvider({ isDev: false })).toThrow(AiError);
		expect(() => selectVisionProvider({ apiKey: '   ', isDev: false })).toThrow(AiError);
	});
});
