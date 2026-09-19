<script lang="ts">
	import { untrack } from 'svelte';
	import { Barbell, ForkKnife, ListChecks, Trash, Wallet } from 'phosphor-svelte';
	import type { Component } from 'svelte';
	import Sheet from '$lib/components/ui/sheet.svelte';
	import {
		addPlanItem,
		removePlanItem,
		updatePlanItem,
		validatePlanDraft
	} from '$lib/services/planService';
	import { ui } from '$lib/state/ui.svelte';
	import { plannerStore } from '$lib/stores/plannerStore.svelte';
	import { telegram } from '$lib/telegram';
	import { PLAN_KIND_LABELS, PLAN_KINDS, type PlanKind } from '$lib/types/plan';
	import { addDays, getToday } from '$lib/utils/date';

	/**
	 * Полная форма пункта плана.
	 *
	 * Быстрый ввод строкой закрывает «записать на бегу», но у дела бывает
	 * время, тип, заметка и другой день — и всё это должно правиться,
	 * а не пересоздаваться заново.
	 */

	const item = $derived(
		ui.planItemId
			? (plannerStore.planItems.find((entry) => entry.id === ui.planItemId) ?? null)
			: null
	);

	const ICONS: Record<PlanKind, Component> = {
		meal: ForkKnife,
		workout: Barbell,
		money: Wallet,
		task: ListChecks
	};

	const uid = $props.id();

	// Значения снимаются один раз на открытие: иначе синхронизация,
	// пришедшая во время правки, затирала бы набранный текст.
	let title = $state('');
	let time = $state('');
	let kind = $state<PlanKind>('task');
	let note = $state('');
	let date = $state(getToday());
	let errors = $state<Record<string, string>>({});
	let initialized = $state(false);

	$effect(() => {
		if (!ui.planSheetOpen) {
			initialized = false;
			return;
		}

		if (initialized) return;

		untrack(() => {
			const existing = item;
			title = existing?.title ?? ui.planDraftTitle ?? '';
			time = existing?.time ?? '';
			kind = existing?.kind ?? 'task';
			note = existing?.note ?? '';
			date = existing?.date ?? plannerStore.currentDate;
			errors = {};
			initialized = true;
		});
	});

	function buildDraft() {
		return { title, time: time || undefined, kind, note: note || undefined, date };
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();

		const draft = buildDraft();
		const found = validatePlanDraft(draft);
		errors = found;

		if (Object.keys(found).length > 0) {
			telegram.haptic.notification('error');
			return;
		}

		const result = item ? updatePlanItem(item.id, draft) : addPlanItem(draft);

		if (!result.ok) {
			errors = result.errors;
			telegram.haptic.notification('error');
			return;
		}

		telegram.haptic.notification('success');
		ui.closePlanSheet();
	}

	/** Перенос — самое частое действие с невыполненным делом. */
	function moveTo(offset: number) {
		telegram.haptic.selection();
		date = addDays(date, offset);
	}

	function remove() {
		if (!item) return;
		telegram.haptic.impact('medium');
		removePlanItem(item.id);
		ui.closePlanSheet();
	}

	const FIELD =
		'w-full rounded-xl border bg-white/[0.03] px-3 py-2.5 text-sm outline-none ' +
		'transition-colors duration-300 ease-flux placeholder:text-muted-foreground/50 ' +
		'focus:border-lavender';

	const dateLabel = $derived.by(() => {
		const today = getToday(plannerStore.doc.user.timezone);
		if (date === today) return 'сегодня';
		if (date === addDays(today, 1)) return 'завтра';
		if (date === addDays(today, -1)) return 'вчера';

		const [, month, day] = date.split('-').map(Number);
		return `${day}.${String(month).padStart(2, '0')}`;
	});
</script>

<Sheet
	open={ui.planSheetOpen}
	title={item ? 'Изменить дело' : 'Новое дело'}
	onclose={() => ui.closePlanSheet()}
>
	<form onsubmit={submit} class="py-1">
		<label for="{uid}-title" class="text-xs text-muted-foreground">Что сделать</label>
		<input
			id="{uid}-title"
			bind:value={title}
			type="text"
			autocomplete="off"
			placeholder="Ужин"
			aria-invalid={Boolean(errors.title)}
			class="mt-1.5 {FIELD} {errors.title ? 'border-destructive' : 'border-line-strong'}"
		/>
		{#if errors.title}
			<p class="mt-1 text-xs text-destructive">{errors.title}</p>
		{/if}

		<div class="mt-3.5 grid grid-cols-2 gap-3">
			<div class="flex min-w-0 flex-col gap-1.5">
				<label for="{uid}-time" class="text-xs text-muted-foreground">Время</label>
				<!--
					Нативный ввод времени: в WebView Telegram он открывает системный
					барабан, привычный человеку, и не требует своей клавиатуры.
				-->
				<input
					id="{uid}-time"
					bind:value={time}
					type="time"
					class="{FIELD} border-line-strong [color-scheme:dark]"
				/>
			</div>

			<div class="flex min-w-0 flex-col gap-1.5">
				<label for="{uid}-date" class="text-xs text-muted-foreground">День · {dateLabel}</label>
				<input
					id="{uid}-date"
					bind:value={date}
					type="date"
					class="{FIELD} border-line-strong [color-scheme:dark]"
				/>
			</div>
		</div>

		<div class="mt-2 flex gap-1.5">
			<button
				type="button"
				onclick={() => (date = getToday(plannerStore.doc.user.timezone))}
				class="rounded-full border border-line-strong px-3 py-1 text-[11px] text-muted-foreground
				       transition-transform duration-500 ease-flux active:scale-95"
			>
				Сегодня
			</button>
			<button
				type="button"
				onclick={() => moveTo(1)}
				class="rounded-full border border-line-strong px-3 py-1 text-[11px] text-muted-foreground
				       transition-transform duration-500 ease-flux active:scale-95"
			>
				+1 день
			</button>
			<button
				type="button"
				onclick={() => (time = '')}
				class="ml-auto rounded-full border border-line-strong px-3 py-1 text-[11px]
				       text-muted-foreground transition-transform duration-500 ease-flux active:scale-95"
			>
				Без времени
			</button>
		</div>

		<p class="mt-4 text-xs text-muted-foreground">Тип</p>
		<div class="mt-2 grid grid-cols-4 gap-2">
			{#each PLAN_KINDS as value (value)}
				{@const Icon = ICONS[value]}
				<button
					type="button"
					onclick={() => {
						telegram.haptic.selection();
						kind = value;
					}}
					aria-pressed={kind === value}
					class="flex flex-col items-center gap-1.5 rounded-xl border py-2.5
					       transition-[transform,border-color,background-color] duration-500 ease-flux
					       active:scale-95
					       {kind === value
						? 'border-lavender bg-lavender/12 text-lavender'
						: 'border-line/70 bg-white/[0.02] text-muted-foreground'}"
				>
					<Icon size={17} weight="light" />
					<span class="text-[10px]">{PLAN_KIND_LABELS[value]}</span>
				</button>
			{/each}
		</div>

		<label for="{uid}-note" class="mt-4 block text-xs text-muted-foreground">Заметка</label>
		<input
			id="{uid}-note"
			bind:value={note}
			type="text"
			autocomplete="off"
			placeholder="необязательно"
			class="mt-1.5 {FIELD} border-line-strong"
		/>

		<div class="mt-5 flex gap-2">
			{#if item}
				<button
					type="button"
					onclick={remove}
					aria-label="Удалить дело"
					class="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong
					       text-muted-foreground transition-transform duration-500 ease-flux active:scale-90"
				>
					<Trash size={15} weight="light" />
				</button>
			{/if}
			<button
				type="button"
				onclick={() => ui.closePlanSheet()}
				class="flex-1 rounded-full border border-line-strong py-3 text-sm font-medium
				       transition-transform duration-500 ease-flux active:scale-[0.98]"
			>
				Отмена
			</button>
			<button
				type="submit"
				class="flex-[1.4] rounded-full bg-lavender py-3 text-sm font-medium text-void
				       shadow-accent transition-transform duration-500 ease-flux hover:bg-lavender-hi
				       active:scale-[0.98]"
			>
				{item ? 'Сохранить' : 'Добавить'}
			</button>
		</div>
	</form>
</Sheet>
