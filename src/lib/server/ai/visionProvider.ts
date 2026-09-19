import { createAnthropicVisionProvider } from './providers/anthropic';
import { createMockVisionProvider } from './providers/mock';
import { AiError, type VisionFoodProvider } from './types';

export type { VisionFoodProvider } from './types';

/**
 * Выбор провайдера распознавания.
 *
 * Чистая функция без обращений к окружению: правило «без ключа в разработке
 * работает мок, а в продакшене это ошибка конфигурации» проверяется тестом,
 * а не наблюдением. Тихо подсовывать выдуманные калории в проде нельзя —
 * пользователь занесёт их в дневник как настоящие.
 */
export function selectVisionProvider(options: {
	apiKey?: string;
	isDev: boolean;
}): VisionFoodProvider {
	const apiKey = options.apiKey?.trim();

	if (apiKey) return createAnthropicVisionProvider(apiKey);

	if (options.isDev) return createMockVisionProvider();

	throw new AiError('NOT_CONFIGURED', 'Распознавание не настроено', 500);
}
