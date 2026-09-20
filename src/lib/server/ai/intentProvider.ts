import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getConfig } from '../config';
import { INTENT_SYSTEM_PROMPT } from './intentPrompt';
import { intentSchema, normalizeIntent, type ParsedIntent } from './intentSchema';
import { parseIntentLocally } from './providers/mockIntent';
import { AiError } from './types';

/**
 * Разбор сообщения в запись.
 *
 * Отдельный провайдер от распознавания по фото: задача другая, модель
 * вызывается иначе, и стоимость несопоставима — короткий текст дешевле
 * изображения на порядки.
 *
 * Без ключа работает разбор по ключевым словам. Он заметно хуже, но это
 * рабочая деградация, а не заглушка: «потратил 500 на такси» он разбирает
 * верно, а сложные формулировки честно помечает как непонятые.
 */

export interface IntentProvider {
	readonly name: string;
	parseIntent(text: string): Promise<ParsedIntent>;
}

const MODEL = 'claude-opus-5';

/**
 * Насколько правила должны быть уверены, чтобы не звать модель.
 *
 * Ниже этого порога разбор держится на одном существительном или общем
 * виде фразы — там модель действительно решает задачу лучше. Выше —
 * это прямая формулировка со временем, суммой или калориями, и вызов
 * провайдера был бы тратой денег и секунды ожидания.
 */
const RULES_CONFIDENT = 0.8;

/** Короткий текст — короткое ожидание: человек смотрит в чат и ждёт ответа. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Длинное сообщение почти наверняка не команда планировщику. */
const MAX_TEXT_LENGTH = 400;

export function createAnthropicIntentProvider(apiKey: string): IntentProvider {
	const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });

	return {
		name: 'anthropic',

		async parseIntent(text: string): Promise<ParsedIntent> {
			// Сначала правила: «ужин в 19:00» и «потратил 500 на такси» они
			// разбирают точно, мгновенно и бесплатно. Модель нужна там, где
			// правила не уверены, — платить за очевидное незачем.
			const byRules = parseIntentLocally(text);
			if (byRules.confidence >= RULES_CONFIDENT) return byRules;

			try {
				const response = await client.messages.parse({
					model: MODEL,
					max_tokens: 1024,
					system: INTENT_SYSTEM_PROMPT,
					output_config: {
						format: zodOutputFormat(intentSchema),
						// Задача простая и однозначная, а ответа ждут в чате.
						effort: 'low'
					},
					messages: [{ role: 'user', content: text.slice(0, MAX_TEXT_LENGTH) }]
				});

				if (response.stop_reason === 'refusal' || !response.parsed_output) {
					throw new AiError('INVALID_AI_RESPONSE', 'Не удалось разобрать сообщение', 502);
				}

				return normalizeIntent(response.parsed_output);
			} catch (error) {
				if (error instanceof AiError) throw error;

				// Разбор текста — удобство, а не основная возможность.
				// Падать целиком из-за недоступной модели незачем: правила
				// по ключевым словам разберут простые случаи.
				console.error('[intent] модель недоступна, разбираем по ключевым словам', error);
				return parseIntentLocally(text);
			}
		}
	};
}

export function createLocalIntentProvider(): IntentProvider {
	return {
		name: 'local',
		async parseIntent(text: string): Promise<ParsedIntent> {
			return parseIntentLocally(text);
		}
	};
}

let cached: IntentProvider | null = null;

export function resolveIntentProvider(): IntentProvider {
	if (!cached) {
		const { aiApiKey } = getConfig();
		cached = aiApiKey ? createAnthropicIntentProvider(aiApiKey) : createLocalIntentProvider();
	}

	return cached;
}
