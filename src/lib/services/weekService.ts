import { plannerStore } from '$lib/stores/plannerStore.svelte';
import { telegram } from '$lib/telegram';
import { weekShareText, type WeekData, type WeekReport } from '$lib/utils/weekly';

/**
 * Итоги недели на клиенте.
 *
 * Отчёт считается из локальных данных, как и вся аналитика: экран недели
 * открывается без сети и без ожидания сервера. Бот считает то же самое теми же
 * функциями по записям на сервере, поэтому цифры в чате и на экране совпадают.
 */
export function weekDataFromStore(): WeekData {
	const { doc } = plannerStore;

	return {
		foodEntries: plannerStore.foodEntries,
		habits: plannerStore.habits,
		completions: plannerStore.habitCompletions,
		financeEntries: plannerStore.financeEntries,
		planItems: plannerStore.planItems,
		weightEntries: plannerStore.weightEntries,
		calorieGoals: Object.fromEntries(
			Object.values(doc.nutrition).map((day) => [day.date, day.calorieGoal])
		),
		budgets: Object.fromEntries(Object.values(doc.finance).map((day) => [day.date, day.budget])),
		defaultCalorieGoal: doc.settings.calorieGoal,
		defaultBudget: doc.settings.dailyBudget
	};
}

/**
 * Куда ведёт ссылка из «Поделиться».
 *
 * Прямой запуск Mini App: друг, нажавший на ссылку в чате, попадает сразу
 * в приложение, а не в пустую переписку с ботом.
 */
export const BOT_APP_LINK = 'https://t.me/fluxplanner_xbot/app';

export function weekShareUrl(report: WeekReport): string {
	const text = weekShareText(report);
	return `https://t.me/share/url?url=${encodeURIComponent(BOT_APP_LINK)}&text=${encodeURIComponent(text)}`;
}

/**
 * Окно «Поделиться» Telegram.
 *
 * Внутри Telegram ссылка t.me открывается его собственным переходом —
 * иначе клиент ушёл бы во внешний браузер. Вне Telegram — новой вкладкой.
 */
export function shareWeek(report: WeekReport): void {
	const url = weekShareUrl(report);
	// Метод вызывается на самом объекте: вынутая из него функция в части
	// клиентов теряет контекст и молча ничего не открывает.
	const webApp = telegram.webApp as { openTelegramLink?: (link: string) => void } | null;

	telegram.haptic.impact('light');

	if (telegram.isEmbedded && webApp?.openTelegramLink) {
		try {
			webApp.openTelegramLink(url);
			return;
		} catch {
			// Старый клиент без метода — открываем обычной вкладкой.
		}
	}

	window.open(url, '_blank', 'noopener');
}
