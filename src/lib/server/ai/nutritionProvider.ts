import { createLocalNutritionProvider } from './providers/localNutrition';
import type { NutritionProvider } from './types';

export type { FoodNutrition, NutritionProvider } from './types';
export { MATCH_THRESHOLD } from './providers/localNutrition';

/**
 * Выбор справочника питания.
 *
 * Сейчас реализация одна — локальная таблица, — но точка подмены существует
 * с самого начала. Когда понадобится внешняя база (USDA FoodData Central,
 * Open Food Facts), она подключается здесь, и ни pipeline, ни тем более
 * интерфейс сканера об этом не узнают. Ключ такого API, если он появится,
 * читается из окружения на сервере и в бандл клиента не попадает.
 */
export function selectNutritionProvider(): NutritionProvider {
	return createLocalNutritionProvider();
}
