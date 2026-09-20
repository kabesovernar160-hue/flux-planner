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
 * Правила больше не перехватывают разбор.
 *
 * Раньше «ужин в 19:00» разбирался по ключевым словам и до модели не доходил:
 * так быстрее и бесплатно. Но человек пишет не по шаблону — «закинул 1.5к
 * на такси вчера вечером», «съел два яйца и тост», — и там, где правила
 * ошибались, они ошибались молча и уверенно. Модель понимает фразу целиком,
 * поэтому теперь идёт первой, а правила остались запасным вариантом:
 * без ключа, без сети и когда провайдер не ответил.
 */

/** Короткий текст — короткое ожидание: человек смотрит в чат и ждёт ответа. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Длинное сообщение почти наверняка не команда планировщику. */
const MAX_TEXT_LENGTH = 400;

export function createAnthropicIntentProvider(apiKey: string): IntentProvider {
	const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });

	return {
		name: 'anthropic',

		async parseIntent(text: string): Promise<ParsedIntent> {
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
				// Разбор текста — удобство, а не основная возможность, и теперь
				// на нём держится весь ввод фразой. Отвечать человеку ошибкой
				// из-за недоступной модели нельзя: правила разберут простые
				// случаи, а «ужин в 19:00» — как раз простой случай.
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
