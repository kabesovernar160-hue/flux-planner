import {
	quickLogFood,
	repeatMeal,
	undoFoodEntries,
	type FoodSnapshot
} from '$lib/services/nutritionService';
import { toast } from '$lib/state/toast.svelte';
import { telegram } from '$lib/telegram';
import type { MealRepeat } from '$lib/utils/foodHistory';
import type { MealType } from '$lib/utils/meals';

/**
 * Запись в одно касание с отменой.
 *
 * Общая для шторки еды и шторки «Что добавить»: касание по блюду в обеих
 * должно вести себя одинаково — записать сразу и дать пять секунд на
 * «Отменить». Две копии этого кода рано или поздно разошлись бы в тексте
 * тоста или в том, что именно отменяется.
 */

/** 1 блюдо, 2 блюда, 5 блюд, 11 блюд, 21 блюдо. */
export function pluralDishes(n: number): string {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return 'блюдо';
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'блюда';
	return 'блюд';
}

/** Записать блюдо с теми же граммами. false — запись не прошла проверку. */
export function logFoodWithUndo(food: FoodSnapshot, meal: MealType): boolean {
	const result = quickLogFood(food, meal);
	if (!result.ok) return false;

	telegram.haptic.notification('success');
	const id = result.value.id;
	toast.show(`Записано · ${food.name}`, {
		label: 'Отменить',
		run: () => undoFoodEntries([id])
	});
	return true;
}

/** Повторить вчерашний приём целиком. Отмена удаляет ровно созданные записи. */
export function repeatMealWithUndo(item: MealRepeat): boolean {
	const result = repeatMeal(item.items, item.meal);
	if (!result.ok) return false;

	telegram.haptic.notification('success');
	const ids = result.value.map((entry) => entry.id);
	toast.show(
		`Повторён ${item.label.replace('вчерашний ', '')} · ${ids.length} ${pluralDishes(ids.length)}`,
		{ label: 'Отменить', run: () => undoFoodEntries(ids) }
	);
	return true;
}
