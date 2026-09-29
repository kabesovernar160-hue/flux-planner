<script lang="ts">
	import './layout.css';
	import AmbientBackdrop from '$lib/components/ambient-backdrop.svelte';
	import Toast from '$lib/components/ui/toast.svelte';
	import BottomNav from '$lib/components/navigation/bottom-nav.svelte';
	import FoodScanner from '$lib/components/nutrition/food-scanner.svelte';
	import FinanceSheet from '$lib/components/finance/finance-sheet.svelte';
	import HabitSheet from '$lib/components/habits/habit-sheet.svelte';
	import PlanSheet from '$lib/components/plan/plan-sheet.svelte';
	import WeightSheet from '$lib/components/weight/weight-sheet.svelte';
	import OnboardingFlow from '$lib/components/onboarding/onboarding-flow.svelte';
	import CreateSheet from '$lib/components/navigation/create-sheet.svelte';
	import CreateHint from '$lib/components/navigation/create-hint.svelte';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { syncQueue } from '$lib/db/syncQueue.svelte';
	import { billing } from '$lib/state/billing.svelte';
	import { firstRun } from '$lib/state/firstRun.svelte';
	import { session } from '$lib/state/session.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { pwa } from '$lib/pwa/pwa.svelte';
	import { telegram } from '$lib/telegram';
	import { theme } from '$lib/theme';

	let { children } = $props();

	/**
	 * Выбор темы из настроек — только после гидратации.
	 *
	 * До неё в сторе значения по умолчанию, где темы нет, и «как в Telegram»
	 * перебило бы выбранную тему, которую скрипт в app.html уже поставил
	 * по кешу: экран мигнул бы.
	 */
	$effect(() => {
		if (plannerStore.status === 'idle' || plannerStore.status === 'hydrating') return;
		theme.setPreference(plannerStore.doc.settings.theme);
	});

	/**
	 * Что открыть сразу после запуска.
	 *
	 * Значение приходит из ссылки и подписью не проверено, поэтому влияет
	 * только на навигацию: открыть шторку — безопасно, что-либо записывать
	 * по такому параметру нельзя.
	 */
	function openStartTarget(target: string | null): void {
		switch (target) {
			case 'scan':
				ui.openFoodSheet();
				break;
			case 'food':
				ui.openFoodSheet();
				break;
			case 'expense':
				ui.openFinanceSheet(undefined, 'expense');
				break;
			case 'income':
				ui.openFinanceSheet(undefined, 'income');
				break;
			case 'habit':
				ui.openHabitSheet();
				break;
			case 'plan':
				ui.openPlanSheet();
				break;
			case 'week':
				// Итоги недели — экран, а не шторка: из кнопки бота или ссылки
				// человек попадает прямо в отчёт.
				void goto('/week');
				break;
		}
	}

	/**
	 * Приветствие показывается только после гидратации и ответа сервера.
	 *
	 * До гидратации настройки — значения по умолчанию, и онбординг мигнул бы
	 * даже тому, кто его давно прошёл. Ответа сервера ждём по той же причине:
	 * Telegram чистит хранилище webview, и пустая база на устройстве означает
	 * «мы не помним», а не «человек здесь впервые». Пока сервер не сказал, что
	 * о нём ничего не знает, встречать анкетой нельзя.
	 *
	 * Флаг закрытия локальный: сам факт прохождения хранится в настройках
	 * и уезжает в синхронизацию.
	 */
	let onboardingDismissed = $state(false);

	/**
	 * Экран входа живёт сам по себе: без навигации, шторок и приветствия.
	 * Ему нечего предложить, пока человек не вошёл.
	 */
	const bare = $derived(page.url.pathname === '/login');

	/**
	 * Вне Telegram без входа — на экран входа.
	 *
	 * Раньше приложение молча открывалось «только с локальными данными»,
	 * и человек, поставивший его на главный экран, не видел ни одной своей
	 * записи из Telegram, не понимая почему. Теперь он сразу видит, как
	 * войти, а остаться без облака можно одной кнопкой там же.
	 * Правовые страницы открываются и без входа.
	 */
	const OPEN_PATHS = ['/login', '/privacy', '/terms'];

	$effect(() => {
		if (session.status !== 'signedOut') return;
		if (OPEN_PATHS.includes(page.url.pathname)) return;
		void goto('/login', { replaceState: true });
	});

	const needsOnboarding = $derived(
		!onboardingDismissed &&
			!bare &&
			session.profileKnown &&
			plannerStore.status !== 'idle' &&
			plannerStore.status !== 'hydrating' &&
			!plannerStore.doc.settings.onboardedAt
	);

	/**
	 * Открытое приветствие держится до явного закрытия.
	 *
	 * Сохранение анкеты сразу ставит onboardedAt, и без защёлки слой исчезал
	 * бы на том же кадре — последний шаг с первым действием никто бы не увидел.
	 */
	let showOnboarding = $state(false);

	$effect(() => {
		if (needsOnboarding) showOnboarding = true;
	});

	function closeOnboarding() {
		onboardingDismissed = true;
		showOnboarding = false;
	}

	/**
	 * Подсказка у «+» — только на главной и только когда её есть кому увидеть:
	 * не под приветствием, не под шторкой и не раньше, чем экран наполнился.
	 */
	const createHintActive = $derived(
		!bare &&
			page.url.pathname === '/' &&
			firstRun.settled &&
			!needsOnboarding &&
			!showOnboarding &&
			!ui.anySheetOpen
	);

	/**
	 * Запуск приложения: один раз на монтирование.
	 *
	 * Тело обёрнуто в untrack намеренно. Это эффект жизненного цикла, а не
	 * реакция на данные: он подписывается на события Telegram, поднимает
	 * хранилище и запускает синхронизацию. Без untrack он зависел бы от всего,
	 * что прочитал по дороге, — в том числе от документа стора, — и любое
	 * обновление данных перезапускало бы инициализацию целиком.
	 */
	$effect(() =>
		untrack(() => {
			// init() возвращает функцию отписки — иначе обработчики Telegram
			// копились бы при каждом HMR-обновлении.
			const disposeTelegram = telegram.init();
			// После Telegram: тема окружения зависит от того, встроены ли мы в клиент.
			const disposeTheme = theme.init();
			// Установка и сервис-воркер — только вне Telegram.
			const disposePwa = pwa.init(telegram.isEmbedded);

			// Вход на сервере: подпись initData проверяется там, и только после
			// ответа пользователь считается авторизованным. Ждать этого интерфейсу
			// незачем — локальные данные уже на экране.
			void session.authenticate().then(() => billing.refresh());

			// Ссылки вида t.me/бот/app?startapp=scan открывают приложение сразу
			// на нужном действии: из списка чатов (или с кнопки «Действие»
			// на айфоне) до камеры получается один тап.
			openStartTarget(telegram.startParam);

			// UI уже отрисован на безопасных значениях по умолчанию; гидратация
			// из IndexedDB догоняет и перерисовывает его сама. Ждать её нельзя —
			// это и есть local-first.
			const seeded = plannerStore.initialize().then(async () => {
				if (!import.meta.env.DEV) return;
				// Внутри Telegram за dev-сервером стоит настоящий аккаунт (туннель):
				// сид срабатывал на пустом устройстве раньше первой синхронизации,
				// уезжал на сервер, и каждый новый запуск добавлял ещё копию
				// демо-привычек, трат и еды в чужие данные.
				if (telegram.isEmbedded) return;
				// Динамический импорт под DEV-флагом: в прод-бандл сид не попадает.
				const { isDevSeedEnabled, seedDevData } = await import('$lib/db/devSeed');
				if (isDevSeedEnabled(new URL(window.location.href))) seedDevData(plannerStore);
			});

			// Очередь подписывается на изменения сама: стор ничего не знает
			// про синхронизацию, иначе модули замкнулись бы друг на друга.
			const unsubscribe = plannerStore.subscribe(() => syncQueue.queueChange());

			// Первая синхронизация при открытии — подтянуть то, что записано
			// с другого устройства или из чата с ботом.
			const synced = plannerStore.initialize().then(() => syncQueue.syncNow());

			// Пустое хранилище считается пустым только после всего сразу:
			// гидратации, сида и первой синхронизации. Неудача любого шага
			// не должна навсегда оставить главную без содержимого. По той же
			// причине ожидание ограничено: на медленной сети новичок иначе
			// смотрел бы на пустой экран, пока не истечёт запрос синхронизации.
			const SETTLE_LIMIT_MS = 3_000;
			void Promise.race([
				Promise.allSettled([seeded, synced]),
				new Promise((resolve) => setTimeout(resolve, SETTLE_LIMIT_MS))
			]).then(() => (firstRun.settled = true));

			return () => {
				disposeTelegram();
				disposeTheme();
				disposePwa();
				unsubscribe();
				syncQueue.dispose();
				plannerStore.dispose();
			};
		})
	);
</script>

<svelte:head>
	<title>Flux Planner</title>
</svelte:head>

<AmbientBackdrop />

<!--
	Единственный контейнер приложения.
	min-height берётся из --fx-vh: внутри Telegram это стабильная высота окна
	(не прыгает при появлении клавиатуры), в браузере — 100dvh.
	Нижний отступ в 6,5rem — это высота панели (≈59px), её собственный
	отступ и запас под выступающую FAB: без него последний виджет уезжает
	под навигацию.
	max-w-md держит колонку читаемой в десктопном Telegram, где окно шире телефона.
-->
<div
	class="relative mx-auto flex w-full max-w-md flex-col"
	style="
		min-height: var(--fx-vh);
		padding-top: calc(var(--fx-safe-top) + 1rem);
		padding-bottom: calc(var(--fx-safe-bottom) + {bare ? '1.5rem' : '6.5rem'});
		padding-left: calc(var(--fx-safe-left) + 1rem);
		padding-right: calc(var(--fx-safe-right) + 1rem);
	"
>
	{@render children()}
</div>

{#if !bare}
	<BottomNav oncreate={() => ui.openCreateSheet()} />
{/if}
<CreateHint active={createHintActive} />

{#if showOnboarding}
	<OnboardingFlow onclose={closeOnboarding} />
{/if}

<CreateSheet />
<FoodScanner open={ui.foodSheetOpen} onclose={() => ui.closeFoodSheet()} />
<FinanceSheet />
<HabitSheet />
<PlanSheet />
<WeightSheet />

<!-- Последним: «Отменить» после быстрой записи виден поверх всего. -->
<Toast />
