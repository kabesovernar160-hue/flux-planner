import type { FinanceCategory, FinanceEntryType } from '$lib/types/finance';

/**
 * Состояние оверлеев приложения.
 *
 * Шторки открываются из разных мест: кнопка «Сканировать еду» лежит в виджете
 * питания, быстрые категории — в виджете финансов, а плавающий плюс — в нижней
 * навигации, то есть в layout. Держать флаги внутри виджетов значит не давать
 * до них добраться из навигации.
 */
class UiState {
	/** Выбор того, что добавить. Открывается плавающей кнопкой. */
	createSheetOpen = $state(false);

	/** Шторка еды: фото или ручной ввод. */
	foodSheetOpen = $state(false);

	/** Шторка траты или дохода. */
	financeSheetOpen = $state(false);

	/** Шторка дела: создание или правка. */
	planSheetOpen = $state(false);

	/** Правимое дело. Как и у привычек — идентификатор, а не объект. */
	planItemId = $state<string | null>(null);

	/** Заготовка названия: из быстрого ввода можно открыть полную форму. */
	planDraftTitle = $state<string | undefined>(undefined);

	/** Шторка привычки: создание или правка. */
	habitSheetOpen = $state(false);

	/** Шторка взвешивания. */
	weightSheetOpen = $state(false);

	/**
	 * Идентификатор правимой привычки, а не сама запись.
	 *
	 * Объект из стора здесь быстро устарел бы: привычку могли изменить
	 * или удалить с другого устройства, пока шторка открыта.
	 */
	habitId = $state<string | null>(null);

	/** Предвыбранная категория для формы трат. Приходит из быстрых кнопок. */
	financeCategory = $state<FinanceCategory | undefined>(undefined);

	/** Предвыбранный тип записи: кнопка «Доход» должна открывать форму дохода. */
	financeType = $state<FinanceEntryType | undefined>(undefined);

	/** Правимая запись. Как и у привычек — идентификатор, а не объект. */
	financeEntryId = $state<string | null>(null);

	/** Открыта ли хоть одна шторка. Подсказкам поверх шторки не место. */
	get anySheetOpen(): boolean {
		return (
			this.createSheetOpen ||
			this.foodSheetOpen ||
			this.financeSheetOpen ||
			this.planSheetOpen ||
			this.habitSheetOpen ||
			this.weightSheetOpen
		);
	}

	openCreateSheet() {
		this.createSheetOpen = true;
	}

	closeCreateSheet() {
		this.createSheetOpen = false;
	}

	openFoodSheet() {
		// Выбор закрывается сразу: две шторки одна поверх другой — это путаница
		// и два накладывающихся затемнения.
		this.createSheetOpen = false;
		this.foodSheetOpen = true;
	}

	closeFoodSheet() {
		this.foodSheetOpen = false;
	}

	openPlanSheet(options: { id?: string; title?: string } = {}) {
		this.createSheetOpen = false;
		this.planItemId = options.id ?? null;
		this.planDraftTitle = options.title;
		this.planSheetOpen = true;
	}

	closePlanSheet() {
		this.planSheetOpen = false;
		this.planItemId = null;
		this.planDraftTitle = undefined;
	}

	openHabitSheet(habitId?: string) {
		this.createSheetOpen = false;
		this.habitId = habitId ?? null;
		this.habitSheetOpen = true;
	}

	closeHabitSheet() {
		this.habitSheetOpen = false;
		this.habitId = null;
	}

	openWeightSheet() {
		this.createSheetOpen = false;
		this.weightSheetOpen = true;
	}

	closeWeightSheet() {
		this.weightSheetOpen = false;
	}

	openFinanceSheet(category?: FinanceCategory, type?: FinanceEntryType) {
		this.createSheetOpen = false;
		this.financeCategory = category;
		this.financeType = type;
		this.financeEntryId = null;
		this.financeSheetOpen = true;
	}

	editFinanceEntry(id: string) {
		this.createSheetOpen = false;
		this.financeCategory = undefined;
		this.financeType = undefined;
		this.financeEntryId = id;
		this.financeSheetOpen = true;
	}

	closeFinanceSheet() {
		this.financeSheetOpen = false;
		this.financeCategory = undefined;
		this.financeType = undefined;
		this.financeEntryId = null;
	}
}

export const ui = new UiState();
