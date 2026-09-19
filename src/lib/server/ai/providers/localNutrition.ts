import { findFoodById, searchFoods, MATCH_THRESHOLD } from '$lib/utils/foodSearch';
import type { FoodNutrition, NutritionProvider } from '../types';

export { MATCH_THRESHOLD };

/**
 * Справочник питания поверх локальной таблицы.
 *
 * Сам поиск живёт в $lib/utils/foodSearch и общий с приложением: ручной ввод
 * подсказывает продукты той же функцией, которой распознавание превращает
 * «Куриное филе на гриле» в запись справочника. Иначе одно и то же название
 * давало бы разные калории в зависимости от того, кто спросил.
 */
export function createLocalNutritionProvider(): NutritionProvider {
	return {
		name: 'local-table',

		async searchFood(query: string): Promise<FoodNutrition[]> {
			return searchFoods(query);
		},

		async getNutrition(foodId: string): Promise<FoodNutrition | null> {
			return findFoodById(foodId);
		}
	};
}
