import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '$lib/types/planner';
import {
	clearAllData,
	createDefaultDocument,
	getStorageKind,
	loadPlannerState,
	migrateDocument,
	saveFinanceEntry,
	saveFoodEntry,
	saveHabit,
	saveHabitCompletion,
	savePlannerDocument
} from './localDb';
import { getDriver, PLANNER_DOC_KEY, resetDriverForTests, STORES } from './storage';
import { createId } from '$lib/utils/id';

beforeEach(async () => {
	resetDriverForTests();
	await clearAllData();
});

describe('драйвер хранилища', () => {
	it('в тестах поднимается настоящий IndexedDB, а не ветка деградации', async () => {
		expect(await getStorageKind()).toBe('indexeddb');
	});
});

describe('migrateDocument', () => {
	it('отвергает не-объект', () => {
		expect(migrateDocument(null)).toBeNull();
		expect(migrateDocument('строка')).toBeNull();
		expect(migrateDocument(42)).toBeNull();
		expect(migrateDocument([])).toBeNull();
	});

	it('отвергает документ новее текущей схемы', () => {
		// Поля могли поменять смысл — читать такой документ опаснее, чем начать заново.
		expect(migrateDocument({ schemaVersion: SCHEMA_VERSION + 1 })).toBeNull();
	});

	it('достраивает отсутствующие поля до значений по умолчанию', () => {
		const migrated = migrateDocument({ schemaVersion: SCHEMA_VERSION });

		expect(migrated).not.toBeNull();
		expect(migrated?.settings.calorieGoal).toBeGreaterThan(0);
		expect(migrated?.user.telegramUserId).toBeNull();
		expect(migrated?.nutrition).toEqual({});
	});

	it('сохраняет пользовательские настройки поверх умолчаний', () => {
		const migrated = migrateDocument({
			schemaVersion: SCHEMA_VERSION,
			settings: { calorieGoal: 1800 }
		});

		expect(migrated?.settings.calorieGoal).toBe(1800);
		// Незаданные поля берутся из умолчаний, а не становятся undefined.
		expect(migrated?.settings.waterGoalMl).toBeGreaterThan(0);
	});

	it('выбрасывает битые дневные записи, оставляя валидные', () => {
		const migrated = migrateDocument({
			schemaVersion: SCHEMA_VERSION,
			nutrition: {
				'2026-01-15': {
					date: '2026-01-15',
					calorieGoal: 2000,
					proteinGoal: 100,
					fatGoal: 60,
					carbsGoal: 200,
					waterGoalMl: 2000,
					waterConsumedMl: 500
				},
				'2026-01-16': { сломано: true }
			}
		});

		expect(Object.keys(migrated?.nutrition ?? {})).toEqual(['2026-01-15']);
	});

	it('чинит невалидный часовой пояс', () => {
		const migrated = migrateDocument({ schemaVersion: SCHEMA_VERSION, user: { timezone: '' } });
		expect(migrated?.user.timezone.length).toBeGreaterThan(0);
	});
});

describe('loadPlannerState', () => {
	it('на пустом хранилище отдаёт безопасные умолчания', async () => {
		const state = await loadPlannerState();

		expect(state.schemaVersion).toBe(SCHEMA_VERSION);
		expect(state.foodEntries).toEqual([]);
		expect(state.habits).toEqual([]);
		expect(state.financeEntries).toEqual([]);
	});

	it('переживает повреждённый документ состояния', async () => {
		const driver = await getDriver();
		await driver.put(STORES.plannerState, 'это не документ', PLANNER_DOC_KEY);

		const state = await loadPlannerState();

		// Не бросает и отдаёт рабочее состояние.
		expect(state.schemaVersion).toBe(SCHEMA_VERSION);
		expect(state.settings.calorieGoal).toBeGreaterThan(0);
	});

	it('отбрасывает битые записи поштучно, сохраняя валидные соседние', async () => {
		const driver = await getDriver();

		await saveFoodEntry({
			id: 'ok',
			date: '2026-01-15',
			name: 'Овсянка',
			calories: 400,
			protein: 12,
			fat: 8,
			carbs: 60,
			source: 'manual',
			createdAt: '2026-01-15T08:00:00.000Z',
			updatedAt: '2026-01-15T08:00:00.000Z'
		});

		// У этой записи калории не число — она должна выпасть.
		await driver.put(STORES.foodEntries, {
			id: 'broken',
			date: '2026-01-15',
			name: 'Мусор',
			calories: 'много',
			protein: 0,
			fat: 0,
			carbs: 0
		});

		const state = await loadPlannerState();

		expect(state.foodEntries).toHaveLength(1);
		expect(state.foodEntries[0].id).toBe('ok');
	});
});

describe('запись и чтение', () => {
	it('документ переживает перезагрузку', async () => {
		const document = createDefaultDocument('Europe/Moscow');
		document.settings.calorieGoal = 1750;
		await savePlannerDocument(document);

		resetDriverForTests();
		const state = await loadPlannerState();

		expect(state.settings.calorieGoal).toBe(1750);
		expect(state.user.timezone).toBe('Europe/Moscow');
	});

	it('порядок привычек сохраняется, а не следует за ключом IndexedDB', async () => {
		// Регрессия: getAll отдаёт записи в порядке первичного ключа, и на
		// случайных id список перетасовывался при каждой перезагрузке.
		const names = ['Зарядка', 'Вода', 'Чтение', 'Витамины', 'Прогулка'];

		for (const [index, name] of names.entries()) {
			await saveHabit({
				id: createId(),
				name,
				icon: 'check',
				frequency: 'daily',
				// Одинаковое время создания — как у сида, создающего их в один тик.
				createdAt: '2026-01-15T08:00:00.000Z',
				updatedAt: `2026-01-15T08:00:0${index}.000Z`,
				archived: false
			});
		}

		resetDriverForTests();
		const state = await loadPlannerState();

		expect(state.habits.map((habit) => habit.name)).toEqual(names);
	});

	it('коллекции переживают перезагрузку', async () => {
		await saveHabit({
			id: 'h1',
			name: 'Зарядка',
			icon: 'barbell',
			frequency: 'daily',
			createdAt: '2026-01-15T08:00:00.000Z',
			updatedAt: '2026-01-15T08:00:00.000Z',
			archived: false
		});
		await saveHabitCompletion({
			id: 'c1',
			habitId: 'h1',
			date: '2026-01-15',
			completed: true,
			createdAt: '2026-01-15T08:00:00.000Z',
			updatedAt: '2026-01-15T08:00:00.000Z'
		});
		await saveFinanceEntry({
			id: 'f1',
			date: '2026-01-15',
			type: 'expense',
			amount: 920,
			category: 'food',
			createdAt: '2026-01-15T08:00:00.000Z',
			updatedAt: '2026-01-15T08:00:00.000Z'
		});

		resetDriverForTests();
		const state = await loadPlannerState();

		expect(state.habits).toHaveLength(1);
		expect(state.habitCompletions).toHaveLength(1);
		expect(state.financeEntries).toHaveLength(1);
		expect(state.financeEntries[0].amount).toBe(920);
	});
});
