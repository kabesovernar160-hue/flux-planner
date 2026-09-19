<script lang="ts">
	import { Camera, Check, Images, PencilSimple, Star, Warning } from 'phosphor-svelte';
	import Sheet from '$lib/components/ui/sheet.svelte';
	import FoodForm from './food-form.svelte';
	import ScanItemCard from './scan-item-card.svelte';
	import { addScannedFood } from '$lib/services/nutritionService';
	import { billing } from '$lib/state/billing.svelte';
	import { session } from '$lib/state/session.svelte';
	import type { FoodScanItem, FoodScanResult } from '$lib/types/nutrition';
	import { telegram } from '$lib/telegram';
	import { authHeaders } from '$lib/telegram/auth';
	import {
		averageConfidence,
		CONFIDENCE_HINTS,
		CONFIDENCE_LABELS,
		confidenceLevel,
		sumTotals
	} from '$lib/utils/foodScan';
	import { formatMacro, formatNumber } from '$lib/utils/format';
	import { FILE_ACCEPT, ImageError, prepareImageForUpload } from '$lib/utils/image';

	type Props = {
		open: boolean;
		onclose: () => void;
	};

	let { open, onclose }: Props = $props();

	/**
	 * Состояния сканера.
	 *
	 * Разложены явно, потому что каждое из них — отдельный экран со своим
	 * содержимым. Один общий флаг loading здесь не годится: «готовим фото»,
	 * «распознаём» и «считаем» длятся по-разному, и человеку важно понимать,
	 * чего он ждёт.
	 */
	type Stage =
		'idle' | 'preparing' | 'preview' | 'analyzing' | 'result' | 'error' | 'manual' | 'confirmed';

	/** Шаги внутри одного сетевого запроса — только для текста на экране. */
	type Phase = 'uploading' | 'recognizing' | 'calculating';

	const PHASE_TEXT: Record<Phase, string> = {
		uploading: 'Отправляем фото…',
		recognizing: 'Рассматриваем фото и определяем продукты…',
		calculating: 'Рассчитываем примерные значения…'
	};

	let stage = $state<Stage>('idle');
	let phase = $state<Phase>('uploading');

	let file: File | null = null;
	let previewUrl = $state<string | null>(null);
	let previewFailed = $state(false);

	let items = $state<FoodScanItem[]>([]);
	let reportedConfidence = $state(0);
	let errorMessage = $state('');
	/** Отдельно от текста: от вида ошибки зависит набор кнопок под ней. */
	let errorRecoverable = $state(true);
	/** Лимит тарифа исчерпан: вместо «попробовать ещё» нужен переход к подписке. */
	let quotaExceeded = $state(false);

	let cameraInput = $state<HTMLInputElement | null>(null);
	let galleryInput = $state<HTMLInputElement | null>(null);
	let phaseTimers: ReturnType<typeof setTimeout>[] = [];

	const totals = $derived(sumTotals(items));

	/**
	 * Итоговая уверенность пересчитывается по оставшимся компонентам:
	 * если убрать неопознанный соус, оценка блюда становится честнее.
	 */
	const overall = $derived(Math.min(reportedConfidence, averageConfidence(items)));
	const level = $derived(confidenceLevel(overall));

	const LEVEL_CLASS: Record<string, string> = {
		high: 'bg-success/12 text-success',
		medium: 'bg-lavender/12 text-lavender',
		low: 'bg-white/[0.06] text-muted-foreground'
	};

	/**
	 * Распознавание работает только с сервером, а сервер пускает только
	 * по подписи Telegram. В обычном браузере это не поломка, а нормальное
	 * состояние — но сказать об этом надо до того, как человек выберет фото.
	 */
	const scanAvailable = $derived(session.status !== 'local');

	function clearTimers() {
		for (const timer of phaseTimers) clearTimeout(timer);
		phaseTimers = [];
	}

	function releasePreview() {
		if (previewUrl) {
			// Объектные URL живут до конца сессии страницы: без revoke
			// каждое распознавание навсегда оставляет копию фото в памяти.
			URL.revokeObjectURL(previewUrl);
			previewUrl = null;
		}
		// Сброс обязателен: иначе одна неудачная картинка навсегда прячет
		// превью и для всех следующих попыток.
		previewFailed = false;
		file = null;
	}

	function reset() {
		clearTimers();
		releasePreview();
		stage = 'idle';
		items = [];
		reportedConfidence = 0;
		errorMessage = '';
		errorRecoverable = true;
		quotaExceeded = false;
		if (cameraInput) cameraInput.value = '';
		if (galleryInput) galleryInput.value = '';
	}

	function handleClose() {
		reset();
		telegram.hideMainButton();
		onclose();
	}

	function fail(message: string, recoverable = true) {
		clearTimers();
		errorMessage = message;
		errorRecoverable = recoverable;
		stage = 'error';
		telegram.haptic.notification('error');
	}

	async function pick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const picked = input.files?.[0];
		if (!picked) return;

		stage = 'preparing';
		releasePreview();

		try {
			// Сжатие и снятие EXIF идут до отправки: на сервер уходит
			// изображение еды и ничего больше — ни координат, ни модели телефона.
			file = await prepareImageForUpload(picked);
			previewUrl = URL.createObjectURL(file);
			stage = 'preview';
			telegram.haptic.impact('light');
		} catch (error) {
			fail(error instanceof ImageError ? error.message : 'Не удалось прочитать фотографию');
		} finally {
			// Обнуляем input, иначе повторный выбор того же файла
			// не вызовет change и кнопка будет выглядеть сломанной.
			input.value = '';
		}
	}

	async function analyze() {
		if (!file) return;

		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			fail('Для сканирования нужна связь с сервером. Блюдо можно добавить вручную.');
			return;
		}

		clearTimers();
		stage = 'analyzing';
		phase = 'uploading';

		// Один запрос — три понятные фазы. Секунды подобраны по типичному
		// времени ответа: это подпись к ожиданию, а не индикатор прогресса,
		// и притворяться точной она не должна.
		phaseTimers.push(setTimeout(() => (phase = 'recognizing'), 900));
		phaseTimers.push(setTimeout(() => (phase = 'calculating'), 6_000));

		const body = new FormData();
		body.append('image', file);

		try {
			const response = await fetch('/api/nutrition/analyze', {
				method: 'POST',
				headers: authHeaders(),
				body
			});

			const payload = await response.json().catch(() => null);
			clearTimers();

			if (!response.ok) {
				const code = payload?.error?.code;

				// Исчерпанный лимит — не ошибка, а состояние тарифа:
				// предлагать «попробовать ещё раз» здесь бессмысленно.
				if (code === 'QUOTA_EXCEEDED') {
					billing.applyQuota(payload?.quota);
					quotaExceeded = true;
					fail(payload?.error?.message ?? 'Распознавания на сегодня закончились', false);
					return;
				}

				// Сервер присылает разобранный конверт с понятным текстом;
				// на случай, если ответ вообще не разобрался, есть запасная строка.
				fail(
					payload?.error?.message ?? 'Не удалось распознать блюдо',
					code !== 'NOT_CONFIGURED' && code !== 'PROVIDER_AUTH'
				);
				return;
			}

			const result = payload.result as FoodScanResult;
			items = result.items;
			reportedConfidence = result.overallConfidence;
			// Остаток приходит вместе с результатом — отдельный запрос не нужен.
			billing.applyQuota(payload?.quota);
			stage = 'result';
			telegram.haptic.notification('success');
		} catch {
			// Сеть отвалилась или запрос прерван.
			fail('Нет связи с сервером. Проверьте интернет');
		}
	}

	function updateItem(index: number, next: FoodScanItem) {
		items[index] = next;
	}

	function removeItem(index: number) {
		items.splice(index, 1);
		if (items.length === 0) {
			// Убрали всё до единого — подтверждать нечего, возвращаемся к съёмке.
			fail('Все продукты убраны. Снимите блюдо заново или добавьте его вручную.');
		}
	}

	function confirm() {
		if (items.length === 0) return;

		const result = addScannedFood($state.snapshot(items));

		if (!result.ok) {
			fail(Object.values(result.errors)[0] ?? 'Не удалось сохранить записи');
			return;
		}

		telegram.haptic.notification('success');
		clearTimers();
		releasePreview();
		stage = 'confirmed';

		// Шторка закрывается сама: после подтверждения смотреть здесь нечего,
		// а результат виден на дашборде.
		phaseTimers.push(setTimeout(handleClose, 1_400));
	}

	/**
	 * Главная кнопка Telegram дублирует основное действие экрана.
	 *
	 * Только на тех шагах, где действие ровно одно: на выборе фото и в ошибке
	 * вариантов несколько, и подменять их одной кнопкой значило бы прятать
	 * половину сценария.
	 */
	$effect(() => {
		if (!open) return;

		if (stage === 'preview') {
			telegram.setMainButton({ text: 'Распознать', onClick: analyze });
		} else if (stage === 'result' && items.length > 0) {
			telegram.setMainButton({ text: 'Добавить в дневник', onClick: confirm });
		} else if (stage === 'analyzing') {
			telegram.setMainButton({ text: 'Распознаём…', onClick: () => {}, loading: true });
		} else {
			telegram.hideMainButton();
		}
	});

	// Страховка на случай размонтирования с открытым предпросмотром.
	$effect(() => () => {
		clearTimers();
		releasePreview();
		telegram.hideMainButton();
	});
</script>

<Sheet {open} title="Сканировать еду" onclose={handleClose}>
	<!--
		Два отдельных input: с capture браузер на телефоне открывает камеру,
		без него — галерею. Одним элементом получить оба поведения нельзя.
	-->
	<input
		bind:this={cameraInput}
		type="file"
		accept={FILE_ACCEPT}
		capture="environment"
		class="sr-only"
		onchange={pick}
	/>
	<input
		bind:this={galleryInput}
		type="file"
		accept={FILE_ACCEPT}
		class="sr-only"
		onchange={pick}
	/>

	{#if stage === 'idle'}
		<div class="py-2">
			<p class="mb-5 text-sm leading-relaxed text-muted-foreground">
				Сфотографируйте блюдо целиком, сверху или под углом. Чем лучше видно порцию, тем точнее
				оценка.
			</p>

			{#if !scanAvailable}
				<p
					class="mb-4 rounded-card border border-line/70 bg-white/[0.02] p-3.5 text-xs
				          leading-relaxed text-muted-foreground"
				>
					Распознавание по фото работает внутри Telegram: снимок обрабатывается на сервере, а вход
					туда — по подписи Telegram. Здесь доступен ручной ввод.
				</p>
			{:else}
				<button
					type="button"
					onclick={() => cameraInput?.click()}
					class="flex w-full items-center justify-center gap-2 rounded-full bg-lavender py-3
					       text-sm font-medium text-void shadow-accent transition-transform duration-500
					       ease-flux hover:bg-lavender-hi active:scale-[0.98]"
				>
					<Camera size={17} weight="light" />
					Сделать фото
				</button>
				<button
					type="button"
					onclick={() => galleryInput?.click()}
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-full border
					       border-line-strong py-3 text-sm font-medium transition-transform duration-500
					       ease-flux active:scale-[0.98]"
				>
					<Images size={17} weight="light" />
					Выбрать из галереи
				</button>
			{/if}

			<button
				type="button"
				onclick={() => (stage = 'manual')}
				class="mt-2 flex w-full items-center justify-center gap-2 rounded-full border
				       border-line-strong py-3 text-sm font-medium transition-transform duration-500
				       ease-flux active:scale-[0.98]"
			>
				<PencilSimple size={16} weight="light" />
				Добавить вручную
			</button>

			<p class="mt-4 text-xs leading-relaxed text-muted-foreground/70">
				Оценка по фотографии приблизительна: вес порции, масло и сахар по снимку не видны. Результат
				всегда можно поправить перед сохранением.
			</p>
		</div>
	{:else if stage === 'manual'}
		<FoodForm onsaved={handleClose} oncancel={reset} />
	{:else if stage === 'confirmed'}
		<div class="flex flex-col items-center py-10 text-center">
			<span class="grid size-14 place-items-center rounded-full bg-success/12">
				<Check size={24} weight="light" class="text-success" />
			</span>
			<p class="mt-4 text-sm font-medium">Готово! Еда добавлена в дневник.</p>
		</div>
	{:else}
		{#if previewUrl && !previewFailed}
			<!--
				Если браузер не смог отрисовать выбранный файл, превью убирается
				целиком: битая иконка с alt-текстом выглядит как поломка приложения,
				хотя распознавание при этом может отработать штатно.
			-->
			<img
				src={previewUrl}
				alt="Фотография блюда"
				onerror={() => (previewFailed = true)}
				class="mb-4 aspect-[4/3] w-full rounded-card border border-line object-cover"
			/>
		{/if}

		{#if stage === 'preparing'}
			<div class="py-6 text-center" aria-live="polite" aria-busy="true">
				<p class="text-sm text-muted-foreground">Готовим фотографию…</p>
			</div>
		{:else if stage === 'preview'}
			<div class="py-1">
				<p class="mb-4 text-sm leading-relaxed text-muted-foreground">
					Видно ли блюдо целиком? Если снимок смазан или еда попала в кадр частично, лучше переснять
					— по такому фото оценка будет хуже.
				</p>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={reset}
						class="flex-1 rounded-full border border-line-strong py-3 text-sm font-medium
						       transition-transform duration-500 ease-flux active:scale-[0.98]"
					>
						Отменить
					</button>
					<button
						type="button"
						onclick={() => cameraInput?.click()}
						class="flex-1 rounded-full border border-line-strong py-3 text-sm font-medium
						       transition-transform duration-500 ease-flux active:scale-[0.98]"
					>
						Переснять
					</button>
					<button
						type="button"
						onclick={analyze}
						class="flex-[1.4] rounded-full bg-lavender py-3 text-sm font-medium text-void
						       shadow-accent transition-transform duration-500 ease-flux
						       hover:bg-lavender-hi active:scale-[0.98]"
					>
						Распознать
					</button>
				</div>
			</div>
		{:else if stage === 'analyzing'}
			<!--
				Скелет повторяет форму итогового блока, а не крутящийся индикатор:
				так не происходит скачка вёрстки в момент появления результата.
			-->
			<div class="animate-pulse space-y-3 py-1" aria-live="polite" aria-busy="true">
				<div class="h-5 w-2/3 rounded bg-line"></div>
				<div class="h-14 rounded-card bg-line"></div>
				<div class="h-14 rounded-card bg-line"></div>
				<div class="h-9 w-1/3 rounded bg-line"></div>
			</div>
			<p class="pt-3 text-xs text-muted-foreground" aria-live="polite">{PHASE_TEXT[phase]}</p>
		{:else if stage === 'error'}
			<div class="py-1">
				<div
					class="mb-4 flex items-start gap-2.5 rounded-card border border-destructive/30
					       bg-destructive/10 p-3.5"
				>
					<Warning size={18} weight="light" class="mt-0.5 shrink-0 text-destructive" />
					<p class="text-sm leading-relaxed">{errorMessage}</p>
				</div>

				{#if quotaExceeded}
					<a
						href="/settings"
						onclick={handleClose}
						class="flex w-full items-center justify-center gap-2 rounded-full bg-lavender py-3
						       text-sm font-medium text-void shadow-accent transition-transform duration-500
						       ease-flux active:scale-[0.98]"
					>
						<Star size={15} weight="fill" />
						Посмотреть тариф
					</a>
					<p class="mt-2 mb-2 text-xs leading-relaxed text-muted-foreground">
						Счётчик обнуляется в полночь. Ручной ввод и поиск по справочнику работают без
						ограничений.
					</p>
				{:else if errorRecoverable && scanAvailable}
					<button
						type="button"
						onclick={reset}
						class="w-full rounded-full border border-line-strong py-3 text-sm font-medium
						       transition-transform duration-500 ease-flux active:scale-[0.98]"
					>
						Сделать другое фото
					</button>
				{/if}

				<button
					type="button"
					onclick={() => {
						reset();
						stage = 'manual';
					}}
					class="mt-2 w-full rounded-full bg-lavender py-3 text-sm font-medium text-void
					       shadow-accent transition-transform duration-500 ease-flux
					       hover:bg-lavender-hi active:scale-[0.98]"
				>
					Добавить вручную
				</button>
			</div>
		{:else if stage === 'result'}
			<div class="py-1">
				<div class="mb-3 flex items-center gap-2">
					<h3 class="flex-1 text-sm font-medium">Мы нашли:</h3>
					<span class="rounded-full px-2.5 py-1 text-[11px] {LEVEL_CLASS[level]}">
						{CONFIDENCE_LABELS[level]}
					</span>
				</div>

				<div class="flex flex-col gap-2">
					{#each items as item, index (item.id)}
						<ScanItemCard
							{item}
							onchange={(next) => updateItem(index, next)}
							onremove={() => removeItem(index)}
						/>
					{/each}
				</div>

				<p class="mt-3 text-xs leading-relaxed text-muted-foreground">
					{CONFIDENCE_HINTS[level]}
				</p>

				<div class="mt-5 rounded-card border border-line/70 bg-white/[0.02] p-4">
					<p class="tabular text-4xl leading-none font-semibold tracking-tight">
						{formatNumber(totals.calories)}
						<span class="text-base font-normal text-muted-foreground">ккал</span>
					</p>

					<div class="mt-3.5 grid grid-cols-3 gap-2">
						{#each [['Белки', totals.protein], ['Жиры', totals.fat], ['Углеводы', totals.carbs]] as [label, value] (label)}
							<div class="rounded-xl bg-white/[0.03] px-2 py-2.5 text-center">
								<p class="text-[11px] text-muted-foreground">{label}</p>
								<p class="tabular mt-0.5 text-sm font-medium">{formatMacro(value as number)} г</p>
							</div>
						{/each}
					</div>
				</div>

				<div class="mt-5 flex gap-2">
					<button
						type="button"
						onclick={reset}
						class="flex-1 rounded-full border border-line-strong py-3 text-sm font-medium
						       transition-transform duration-500 ease-flux active:scale-[0.98]"
					>
						Другое фото
					</button>
					<button
						type="button"
						onclick={confirm}
						class="flex flex-[1.4] items-center justify-center gap-2 rounded-full bg-lavender py-3
						       text-sm font-medium text-void shadow-accent transition-transform duration-500
						       ease-flux hover:bg-lavender-hi active:scale-[0.98]"
					>
						<Check size={16} weight="bold" />
						Добавить в дневник
					</button>
				</div>
			</div>
		{/if}
	{/if}
</Sheet>
