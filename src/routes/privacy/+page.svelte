<script lang="ts">
	import { ShieldCheck } from 'phosphor-svelte';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { LEGAL_UPDATED, SUPPORT_CONTACT } from '$lib/legal';
</script>

<svelte:head>
	<title>Конфиденциальность — Flux Planner</title>
</svelte:head>

<PageHeader title="Конфиденциальность" subtitle="Обновлено {LEGAL_UPDATED}" back="/settings" />

<div class="space-y-3 pb-4">
	<GlassCard>
		<h2 class="mb-2 flex items-center gap-2 text-sm font-medium">
			<ShieldCheck size={15} weight="light" class="text-lavender" />
			Коротко
		</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Данные лежат на вашем устройстве. Копия уезжает на сервер только затем, чтобы дневник открылся
			с другого телефона и из чата с ботом. Рекламы, трекеров и передачи данных на сторону нет.
			Фотографии еды не хранятся.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Что мы храним</h2>
		<ul class="space-y-2 text-xs leading-relaxed text-muted-foreground">
			<li>
				<span class="text-foreground">Записи дневника</span> — еда, привычки, траты и доходы, планы, цели
				по калориям и макросам.
			</li>
			<li>
				<span class="text-foreground">Анкету</span> — пол, возраст, рост, вес и уровень активности. Из
				них считаются цели, больше они ни для чего не нужны.
			</li>
			<li>
				<span class="text-foreground">Ваш идентификатор в Telegram</span>, имя и username в том
				виде, в каком их присылает Telegram, и часовой пояс устройства — чтобы день заканчивался
				вовремя.
			</li>
			<li>
				<span class="text-foreground">Платежи</span> — номер операции Telegram, сумму в звёздах и срок
				подписки. Карту и платёжные данные мы не видим: их обрабатывает Telegram.
			</li>
		</ul>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Где это лежит</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Основное хранилище — память браузера на вашем устройстве (IndexedDB): приложение открывается и
			работает без сети. Когда приложение запущено из Telegram, копия записей синхронизируется с
			нашим сервером — иначе телефон и планшет показывали бы разные дни, а бот не знал бы, что вам
			написать вечером. В обычном браузере, без Telegram, синхронизации нет: данные не покидают
			устройство.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Фотографии еды</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Снимок уменьшается прямо на устройстве, отправляется провайдеру распознавания (Anthropic) и
			после ответа исчезает вместе с запросом: на диск он не пишется и в базу не попадает.
			Сохраняется только разбор — названия продуктов и вес, — и только после того, как вы нажали
			«Добавить в дневник». Когда фото прислано боту в чат, разбор ждёт вашего подтверждения во
			временной записи и удаляется сразу после ответа.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Чего мы не делаем</h2>
		<ul class="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
			<li>Не продаём и не передаём данные третьим лицам.</li>
			<li>Не ставим рекламных и аналитических трекеров.</li>
			<li>Не читаем вашу переписку в Telegram: боту видно только то, что вы прислали ему сами.</li>
			<li>Не пишем в журналы содержимое запросов — там остаются метод, маршрут и код ответа.</li>
		</ul>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Ваши данные — ваши</h2>
		<p class="mb-2 text-xs leading-relaxed text-muted-foreground">
			В настройках есть выгрузка: JSON — полный снимок, CSV — таблица о еде. Ничего просить для
			этого не нужно.
		</p>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Кнопка «Стереть локальные данные» очищает устройство. Удалённая запись помечается удалённой и
			на сервере — так удаление доезжает до других ваших устройств. Кнопка «Удалить учётную запись»
			в настройках стирает всё и на сервере: записи исчезают насовсем, а сама учётная запись
			обезличивается. Ждать ответа поддержки для этого не нужно — но если что-то пошло не так,
			напишите <span class="text-foreground">{SUPPORT_CONTACT}</span>. Записи о платежах остаются:
			их хранение требует закон.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Сроки хранения</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Записи дневника хранятся, пока вы пользуетесь приложением, и удаляются по вашему запросу. На
			бесплатном тарифе аналитика и история показывают последние 30 дней — более старые записи
			остаются в базе и снова открываются на Pro, но не удаляются.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Это не медицинское приложение</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Цели по калориям считаются по формуле Миффлина–Сан Жеора, калорийность — по справочнику и
			оценке веса порции. Это ориентир, а не диагноз и не назначение. При заболеваниях, во время
			беременности и при расстройствах пищевого поведения решения принимает врач, а не приложение.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Вопросы</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Пишите <span class="text-foreground">{SUPPORT_CONTACT}</span>. Условия использования —
			<a href="/terms" class="text-lavender underline-offset-2 hover:underline"
				>на соседней странице</a
			>.
		</p>
	</GlassCard>
</div>
