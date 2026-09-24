<script lang="ts">
	import { isHintSeen, markHintSeen } from '$lib/services/hintService';
	import { telegram } from '$lib/telegram';

	type Props = {
		/**
		 * Можно ли показывать сейчас: главная, данные дошли, ни приветствия,
		 * ни шторки поверх. Решает разметка — она знает про всё это сразу.
		 */
		active: boolean;
	};

	let { active }: Props = $props();

	let open = $state(false);

	/**
	 * Подсказка показывается один раз.
	 *
	 * Отметка ставится в момент показа, а не закрытия: человек, который
	 * просто ушёл на другой экран или нажал «+», её уже увидел, и второй
	 * показ был бы навязчивым. Уход с главной или открытая шторка убирают
	 * подсказку насовсем — вернуть её после этого нечем.
	 */
	$effect(() => {
		if (!active) {
			open = false;
			return;
		}

		if (!isHintSeen('createButton')) {
			open = true;
			markHintSeen('createButton');
		}
	});

	function dismiss() {
		telegram.haptic.impact('light');
		open = false;
	}
</script>

{#if open}
	<!--
		Не затемнение на весь экран, а пузырь над кнопкой: подсказка не мешает
		ни читать главную, ни нажать сам «+». Обёртка пропускает касания,
		перехватывает их только пузырь.
	-->
	<div
		class="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
		style="bottom: calc(var(--fx-safe-bottom) + 6.4rem);"
	>
		<button
			type="button"
			onclick={dismiss}
			class="fx-rise pointer-events-auto relative rounded-2xl border border-lavender/30
			       bg-[var(--fx-glass-tint-solid)] px-4 py-2.5 text-center shadow-lift
			       transition-transform duration-500 ease-flux active:scale-[0.97]"
			style="--fx-step: 8;"
		>
			<span class="block text-sm font-medium">Всё добавляется отсюда</span>
			<span class="block text-[11px] text-muted-foreground">Еда, привычки, траты и вес</span>

			<!-- Хвостик указывает на «+»: квадрат, повёрнутый на 45° и наполовину спрятанный. -->
			<span
				aria-hidden="true"
				class="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-r border-b
				       border-lavender/30 bg-[var(--fx-glass-tint-solid)]"
			></span>
		</button>
	</div>
{/if}
