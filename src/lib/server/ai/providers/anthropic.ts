import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from '../prompt';
import { foodRecognitionSchema, normalizeFoodRecognition } from '../schema';
import { AiError, type AnalyzableImage, type VisionFoodProvider } from '../types';

const MODEL = 'claude-opus-5';

/**
 * Пользователь ждёт ответа с телефоном в руке, поэтому таймаут короткий.
 * Значение в миллисекундах: в TypeScript-SDK единица измерения именно такая,
 * в отличие от Python, где секунды. По умолчанию SDK ждёт десять минут —
 * для запроса из мобильного интерфейса это неприемлемо.
 */
const REQUEST_TIMEOUT_MS = 40_000;

/**
 * Кодирование в base64 без Buffer, чтобы модуль работал и на edge-рантаймах.
 *
 * Байты режутся на куски: String.fromCharCode(...bytes) на пятимегабайтном
 * изображении разворачивается в миллионы аргументов и падает с переполнением
 * стека вызовов.
 */
function toBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let binary = '';

	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}

	return btoa(binary);
}

/**
 * Перевод ошибок SDK в наши коды.
 *
 * Сбой авторизации у провайдера — это наша неверная конфигурация, а не проблема
 * клиента, поэтому наружу уходит 500, а не 401: иначе приложение решит,
 * что пользователь не авторизован, и отправит его логиниться заново.
 */
function toAiError(error: unknown): AiError {
	if (error instanceof AiError) return error;

	if (
		error instanceof Anthropic.AuthenticationError ||
		error instanceof Anthropic.PermissionDeniedError
	) {
		return new AiError('PROVIDER_AUTH', 'Распознавание временно недоступно', 500, error);
	}

	if (error instanceof Anthropic.RateLimitError) {
		return new AiError(
			'RATE_LIMITED',
			'Слишком много запросов. Попробуйте через минуту',
			429,
			error
		);
	}

	if (error instanceof Anthropic.APIConnectionTimeoutError) {
		return new AiError(
			'TIMEOUT',
			'Распознавание заняло слишком долго. Попробуйте ещё раз',
			504,
			error
		);
	}

	if (error instanceof Anthropic.APIError) {
		return new AiError('PROVIDER_ERROR', 'Распознавание временно недоступно', 502, error);
	}

	return new AiError('PROVIDER_ERROR', 'Не удалось распознать блюдо', 502, error);
}

export function createAnthropicVisionProvider(apiKey: string): VisionFoodProvider {
	const client = new Anthropic({
		apiKey,
		timeout: REQUEST_TIMEOUT_MS,
		// Одна повторная попытка вместо двух по умолчанию: пользователь ждёт,
		// и три подряд неудачные попытки он воспримет как зависание.
		maxRetries: 1
	});

	return {
		name: 'anthropic',

		async analyzeFood(image: AnalyzableImage) {
			try {
				const response = await client.messages.parse({
					model: MODEL,
					max_tokens: 4096,
					system: VISION_SYSTEM_PROMPT,
					output_config: {
						format: zodOutputFormat(foodRecognitionSchema),
						// Задача перцептивная, а не рассуждательная, и ответа ждут
						// на телефоне. Это главная ручка настройки: если разбор
						// на компоненты окажется поверхностным, поднимать отсюда.
						effort: 'low'
					},
					messages: [
						{
							role: 'user',
							content: [
								{
									type: 'image',
									source: {
										type: 'base64',
										media_type: image.mediaType as
											'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
										data: toBase64(image.bytes)
									}
								},
								{ type: 'text', text: VISION_USER_PROMPT }
							]
						}
					]
				});

				// Отказ модели приходит с HTTP 200, поэтому проверяется явно.
				if (response.stop_reason === 'refusal') {
					throw new AiError('INVALID_AI_RESPONSE', 'Не удалось распознать это изображение', 422);
				}

				// parsed_output равен null, если разбор не удался.
				if (!response.parsed_output) {
					throw new AiError('INVALID_AI_RESPONSE', 'Модель вернула некорректный ответ', 502);
				}

				return normalizeFoodRecognition(response.parsed_output);
			} catch (error) {
				throw toAiError(error);
			}
		}
	};
}
