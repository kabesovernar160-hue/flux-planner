<script lang="ts">
	import { Scroll } from 'phosphor-svelte';
	import { PLANS, SUBSCRIPTION_DAYS } from '$lib/billing/plans';
	import { GlassCard } from '$lib/components/ui/glass-card';
	import PageHeader from '$lib/components/ui/page-header.svelte';
	import { LEGAL_UPDATED, SUPPORT_CONTACT } from '$lib/legal';

	// Цифры берутся из описания тарифов, а не переписываются руками:
	// цена в документе, разошедшаяся с ценой в счёте, — это обман,
	// даже если он случайный.
	const free = PLANS.free;
	const pro = PLANS.pro;
</script>

<svelte:head>
	<title>Условия использования — Flux Planner</title>
</svelte:head>

<PageHeader title="Условия использования" subtitle="Обновлено {LEGAL_UPDATED}" back="/settings" />

<div class="space-y-3 pb-4">
	<GlassCard>
		<h2 class="mb-2 flex items-center gap-2 text-sm font-medium">
			<Scroll size={15} weight="light" class="text-lavender" />
			Что это за приложение
		</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Flux Planner — дневник питания, привычек и финансов внутри Telegram. Пользуясь им, вы
			соглашаетесь с тем, что написано ниже. Не согласны — просто не пользуйтесь: данные с
			устройства можно выгрузить и стереть в настройках.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Тарифы</h2>
		<p class="mb-2 text-xs leading-relaxed text-muted-foreground">
			Бесплатный тариф — рабочее приложение: дневник, привычки, финансы, поиск по справочнику,
			ручной ввод, синхронизация и выгрузка данных доступны полностью. Платятся распознавания по
			фотографии и глубина истории.
		</p>
		<ul class="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
			<li>
				<span class="text-foreground">Бесплатно</span> — {free.limits.scansPerDay} распознавания по фото
				в день, история за {free.limits.historyDays} дней.
			</li>
			<li>
				<span class="text-foreground">Pro, {pro.stars} ⭐ за {SUBSCRIPTION_DAYS} дней</span> —
				{pro.limits.scansPerDay} распознаваний в день, история без ограничения по дням.
			</li>
		</ul>
		<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
			У Pro честный потолок, а не «безлимит»: каждое распознавание стоит денег провайдеру, и обещать
			безграничное значило бы обещать то, чего не будет.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Оплата, продление и возврат</h2>
		<ul class="space-y-2 text-xs leading-relaxed text-muted-foreground">
			<li>
				Оплата проходит звёздами Telegram, внутри Telegram. Карту и платёжные данные мы не видим.
			</li>
			<li>
				Подписка на {SUBSCRIPTION_DAYS} дней с автопродлением. Отменяется там же, где куплена, — в настройках
				Telegram; доступ сохраняется до конца оплаченного периода.
			</li>
			<li>
				Возврат звёзд делается по запросу в поддержку в пределах, которые допускает Telegram. После
				возврата Pro-возможности отключаются сразу.
			</li>
			<li>
				Если оплата прошла, а Pro не включился — напишите
				<span class="text-foreground">{SUPPORT_CONTACT}</span>: у каждого платежа есть номер, по
				нему всё видно.
			</li>
		</ul>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Точность расчётов</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Распознавание по фотографии определяет вес порции приблизительно и не видит масла на
			сковороде, сахара в соусе и скрытых ингредиентов. Поэтому результат всегда показывается вам до
			записи и правится вручную. Цели по калориям считаются по формуле и являются ориентиром.
			Приложение не медицинское: диагнозы, лечение и диеты при заболеваниях — к врачу.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Как пользоваться нельзя</h2>
		<ul class="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
			<li>Обходить лимиты тарифа, автоматизировать запросы, нагружать сервис намеренно.</li>
			<li>Пытаться получить доступ к чужим данным или к серверной части.</li>
			<li>Присылать в распознавание то, что не является едой и нарушает закон.</li>
		</ul>
		<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
			При злоупотреблении доступ может быть ограничен. Оплаченный и неиспользованный период в таком
			случае возвращается.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Доступность и изменения</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Приложение предоставляется «как есть». Мы стараемся, чтобы оно работало, но не обещаем
			непрерывной доступности: бывают сбои, обновления и недоступность провайдера распознавания.
			Ваши данные лежат на устройстве и выгружаются в любой момент — это защита от любых наших
			проблем. Условия и цены могут меняться; об изменениях цены действующей подписки предупредим
			заранее, а к уже оплаченному периоду они не применяются.
		</p>
	</GlassCard>

	<GlassCard>
		<h2 class="mb-2 text-sm font-medium">Связь</h2>
		<p class="text-xs leading-relaxed text-muted-foreground">
			Вопросы, возвраты, удаление данных — <span class="text-foreground">{SUPPORT_CONTACT}</span>.
			Что именно мы храним, описано в
			<a href="/privacy" class="text-lavender underline-offset-2 hover:underline">
				политике конфиденциальности
			</a>.
		</p>
	</GlassCard>
</div>
