<script lang="ts">
	import { CheckCircle, ForkKnife, ListChecks, Wallet } from 'phosphor-svelte';
	import type { Component } from 'svelte';
	import Sheet from '$lib/components/ui/sheet.svelte';
	import { ui } from '$lib/state/ui.svelte';

	const OPTIONS: { label: string; hint: string; icon: Component; open: () => void }[] = [
		{
			label: 'Дело на день',
			hint: 'Название, время, тип',
			icon: ListChecks,
			open: () => ui.openPlanSheet()
		},
		{
			label: 'Еда',
			hint: 'Снять на камеру или вписать вручную',
			icon: ForkKnife,
			open: () => ui.openFoodSheet()
		},
		{
			label: 'Трата или доход',
			hint: 'Сумма, категория, заметка',
			icon: Wallet,
			open: () => ui.openFinanceSheet()
		},
		{
			label: 'Привычка',
			hint: 'Название, иконка, расписание',
			icon: CheckCircle,
			open: () => ui.openHabitSheet()
		}
	];
</script>

<Sheet open={ui.createSheetOpen} title="Что добавить" onclose={() => ui.closeCreateSheet()}>
	<div class="flex flex-col gap-2 py-1">
		{#each OPTIONS as option (option.label)}
			{@const Icon = option.icon}
			<button
				type="button"
				onclick={option.open}
				class="flex items-center gap-3.5 rounded-card border border-line/70 bg-white/[0.02] p-4
				       text-left transition-[transform,border-color] duration-500 ease-flux
				       hover:border-line-strong active:scale-[0.98]"
			>
				<span class="grid size-10 shrink-0 place-items-center rounded-full bg-lavender/12">
					<Icon size={19} weight="light" class="text-lavender" />
				</span>
				<span class="min-w-0">
					<span class="block text-sm font-medium">{option.label}</span>
					<span class="block text-xs text-muted-foreground">{option.hint}</span>
				</span>
			</button>
		{/each}
	</div>
</Sheet>
