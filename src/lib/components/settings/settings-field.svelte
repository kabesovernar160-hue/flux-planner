<script lang="ts">
	import { tick, type Component } from 'svelte';
	import type { IconComponentProps } from 'phosphor-svelte';

	type Props = {
		id: string;
		label: string;
		/** Текущее значение уже отформатировано: «2 100», «72,5» или пусто. */
		value: string;
		unit: string;
		/** Вызывается по уходу с поля с тем, что человек ввёл. */
		oncommit: (raw: string) => void;
		icon?: Component<IconComponentProps>;
		placeholder?: string;
		inputmode?: 'numeric' | 'decimal';
	};

	let {
		id,
		label,
		value,
		unit,
		oncommit,
		icon: Icon,
		placeholder,
		inputmode = 'numeric'
	}: Props = $props();

	/**
	 * После применения поле показывает то, что сохранилось, а не то,
	 * что набрано: «2100» превращается в «2 100», а отброшенное значение
	 * (буквы, выход за пределы) возвращается к прежнему. Без этого поле
	 * продолжало бы показывать неприменённую цифру, и человек решил бы,
	 * что она сохранилась.
	 */
	async function handleBlur(input: HTMLInputElement) {
		oncommit(input.value);
		await tick();
		input.value = value;
	}
</script>

<!--
	Строка с числовым полем — той же высоты и с тем же разделителем,
	что и строка-ссылка, чтобы цели и ссылки в одной группе читались
	одним списком.

	Поле — строка, а не type="number": у числового поля нельзя нормально
	очистить значение, чтобы вписать своё, — bind отдаёт то число,
	то undefined. Применяется значение по уходу с поля, так цель
	не пересчитывается на каждой набранной цифре.
-->
<div class="group/row flex min-h-[52px] items-center gap-3 pl-4">
	{#if Icon}
		<span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tone/12">
			<Icon size={15} weight="regular" class="text-tone" />
		</span>
	{/if}

	<div
		class="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 self-stretch border-t border-line/60
		       py-2 pr-4 group-first/row:border-t-0"
	>
		<label for={id} class="min-w-0 flex-1 text-sm">{label}</label>
		<input
			{id}
			{value}
			{placeholder}
			{inputmode}
			onblur={(event) => handleBlur(event.currentTarget)}
			onkeydown={(event) => {
				if (event.key === 'Enter') event.currentTarget.blur();
			}}
			type="text"
			autocomplete="off"
			class="tabular h-10 w-24 rounded-xl border border-line-strong bg-white/[0.03] px-3 text-right
			       text-sm transition-colors duration-300 ease-flux outline-none
			       placeholder:text-muted-foreground/50 focus:border-tone"
		/>
		<span class="w-9 shrink-0 text-xs text-muted-foreground">{unit}</span>
	</div>
</div>
