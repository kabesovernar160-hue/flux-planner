import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { analyzeFoodImage } from './pipeline';
import { selectNutritionProvider } from './nutritionProvider';
import { selectVisionProvider } from './visionProvider';
import type { AnalyzableImage, NutritionProvider, VisionFoodProvider } from './types';
import type { FoodScanResult } from '$lib/types/nutrition';

export type {
	AnalyzableImage,
	FoodNutrition,
	FoodRecognition,
	NutritionProvider,
	RecognizedFood,
	VisionFoodProvider
} from './types';
export { AiError } from './types';
export { selectVisionProvider } from './visionProvider';
export { selectNutritionProvider } from './nutritionProvider';
export { analyzeFoodImage } from './pipeline';

let visionProvider: VisionFoodProvider | null = null;
let nutritionProvider: NutritionProvider | null = null;

/**
 * Провайдер создаётся один раз на процесс: клиент SDK держит пул соединений,
 * и пересоздавать его на каждый запрос — лишние TLS-рукопожатия.
 */
export function resolveVisionProvider(): VisionFoodProvider {
	visionProvider ??= selectVisionProvider({ apiKey: env.AI_API_KEY, isDev: dev });
	return visionProvider;
}

export function resolveNutritionProvider(): NutritionProvider {
	nutritionProvider ??= selectNutritionProvider();
	return nutritionProvider;
}

/** Полный проход: фотография → компоненты → пищевая ценность → результат. */
export function runFoodScan(image: AnalyzableImage): Promise<FoodScanResult> {
	return analyzeFoodImage(image, {
		vision: resolveVisionProvider(),
		nutrition: resolveNutritionProvider()
	});
}
