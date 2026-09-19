import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '$lib/types/planner';
import {
	clearAllData,
	createDefaultDocument,
	getStorageKind,
	dedupeWeightEntries,
	loadDayRecordsForSync,
	loadPlannerState,
	mergeDayRecordsFromSync,
	migrateDocument,
	saveFinanceEntry,
	saveFoodEntry,
	saveHabit,
	saveHabitCompletion,
	savePlannerDocument,
	saveWeightEntry
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

describe('записи дня в синхронизации', () => {
	const nutritionDay = (overrides: Record<string, unknown> = {}) => ({
		date: '2026-01-15',
		calorieGoal: 2000,
		proteinGoal: 100,
		fatGoal: 60,
		carbsGoal: 200,
		waterGoalMl: 2000,
		waterConsumedMl: 500,
		...overrides
	});

	it('старой записи дня достраиваются служебные поля', () => {
		// Цели дня появились раньше своей синхронизации: в уже сохранённых
		// документах идентификатора и отметок времени нет, а без них
		// запись никогда не уедет на сервер.
		const migrated = migrateDocument({
			schemaVersion: SCHEMA_VERSION,
			nutrition: { '2026-01-15': nutritionDay() }
		});

		const day = migrated?.nutrition['2026-01-15'];

		expect(day?.id.length).toBeGreaterThan(0);
		expect(day?.createdAt.length).toBeGreaterThan(0);
		expect(day?.updatedAt.length).toBeGreaterThan(0);
	});

	it('достроенные поля записываются обратно и не меняются от чтения к чтению', async () => {
		const driver = await getDriver();
		await driver.put(
			STORES.plannerState,
			{ schemaVersion: SCHEMA_VERSION, nutrition: { '2026-01-15': nutritionDay() } },
			PLANNER_DOC_KEY
		);

		const first = await loadPlannerState();
		const second = await loadPlannerState();

		// Иначе один и тот же день уезжал бы на сервер под новым
		// идентификатором после каждого запуска приложения.
		expect(second.nutrition['2026-01-15'].id).toBe(first.nutrition['2026-01-15'].id);
	});

	it('отдаёт записи дня для отправки', async () => {
		await savePlannerDocument({
			...createDefaultDocument(),
			nutrition: {
				'2026-01-15': {
					...nutritionDay(),
					id: 'n1',
					createdAt: '2026-01-15T08:00:00.000Z',
					updatedAt: '2026-01-15T08:00:00.000Z',
					deletedAt: null
				}
			}
		});

		const rows = await loadDayRecordsForSync('nutritionDays');

		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe('n1');
	});

	it('принимает более свежую запись дня и отклоняет отставшую', async () => {
		await savePlannerDocument({
			...createDefaultDocument(),
			nutrition: {
				'2026-01-15': {
					...nutritionDay({ waterConsumedMl: 500 }),
					id: 'n1',
					createdAt: '2026-01-15T08:00:00.000Z',
					updatedAt: '2026-01-15T10:00:00.000Z',
					deletedAt: null
				}
			}
		});

		await mergeDayRecordsFromSync('nutritionDays', [
			{
				...nutritionDay({ waterConsumedMl: 250 }),
				id: 'n1',
				createdAt: '2026-01-15T08:00:00.000Z',
				updatedAt: '2026-01-15T09:00:00.000Z'
			}
		]);

		expect((await loadPlannerState()).nutrition['2026-01-15'].waterConsumedMl).toBe(500);

		await mergeDayRecordsFromSync('nutritionDays', [
			{
				...nutritionDay({ waterConsumedMl: 1750 }),
				id: 'n1',
				createdAt: '2026-01-15T08:00:00.000Z',
				updatedAt: '2026-01-15T12:00:00.000Z'
			}
		]);

		expect((await loadPlannerState()).nutrition['2026-01-15'].waterConsumedMl).toBe(1750);
	});

	it('день, созданный на сервере, появляется локально', async () => {
		await mergeDayRecordsFromSync('financeDays', [
			{
				id: 'fd1',
				date: '2026-01-16',
				budget: 1500,
				createdAt: '2026-01-16T08:00:00.000Z',
				updatedAt: '2026-01-16T08:00:00.000Z'
			}
		]);

		expect((await loadPlannerState()).finance['2026-01-16'].budget).toBe(1500);
	});

	it('битая строка с сервера не ломает документ', async () => {
		await mergeDayRecordsFromSync('nutritionDays', [{ date: '2026-01-15' }, null, 'строка']);

		expect((await loadPlannerState()).nutrition['2026-01-15']).toBeUndefined();
	});
});

describe('дневник веса', () => {
	const weight = (id: string, date: string, weightKg: number, updatedAt: string) => ({
		id,
		date,
		weightKg,
		createdAt: '2026-01-15T08:00:00.000Z',
		updatedAt
	});

	it('на день остаётся одна запись, более свежая', async () => {
		// Два устройства, взвесившиеся офлайн в один день, приходят с разными
		// идентификаторами: сервер сливает их по дню, локально остаются обе.
		await saveWeightEntry(weight('w-a', '2026-01-15', 78, '2026-01-15T08:00:00.000Z'));
		await saveWeightEntry(weight('w-b', '2026-01-15', 77.4, '2026-01-15T10:00:00.000Z'));

		const state = await loadPlannerState();

		expect(state.weightEntries).toHaveLength(1);
		expect(state.weightEntries[0].weightKg).toBe(77.4);
	});

	it('уборка убирает лишнюю строку из хранилища', async () => {
		await saveWeightEntry(weight('w-a', '2026-01-15', 78, '2026-01-15T08:00:00.000Z'));
		await saveWeightEntry(weight('w-b', '2026-01-15', 77.4, '2026-01-15T10:00:00.000Z'));

		await dedupeWeightEntries();

		const driver = await getDriver();
		const rows = await driver.getAll<{ id: string }>(STORES.weightEntries);

		expect(rows.map((row) => row.id)).toEqual(['w-b']);
	});

	it('надгробие при уборке не трогается', async () => {
		// Без надгробия удаление не доедет до других устройств.
		await saveWeightEntry({
			...weight('w-dead', '2026-01-14', 79, '2026-01-14T10:00:00.000Z'),
			deletedAt: '2026-01-14T11:00:00.000Z'
		});

		await dedupeWeightEntries();

		const driver = await getDriver();
		const rows = await driver.getAll<{ id: string }>(STORES.weightEntries);

		expect(rows.map((row) => row.id)).toEqual(['w-dead']);
	});

	it('записи идут по дню, а не по времени создания', async () => {
		await saveWeightEntry(weight('w-new', '2026-01-15', 78, '2026-01-15T08:00:00.000Z'));
		await saveWeightEntry(weight('w-old', '2026-01-10', 80, '2026-01-15T09:00:00.000Z'));

		const state = await loadPlannerState();

		expect(state.weightEntries.map((entry) => entry.date)).toEqual(['2026-01-10', '2026-01-15']);
	});
});
