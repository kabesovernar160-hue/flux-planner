<script lang="ts">
	import { DeviceMobile } from 'phosphor-svelte';
	import SettingsRow from '$lib/components/settings/settings-row.svelte';
	import { telegram } from '$lib/telegram';
	import type { HomeScreenStatus } from '$lib/telegram/types';

	/**
	 * «На главный экран» — ярлык Mini App рядом с обычными приложениями.
	 *
	 * Открывается он всё равно через Telegram, но сразу на весь экран
	 * и без поиска бота в списке чатов: для дневника, который открывают
	 * по нескольку раз в день, это разница между «зайду» и «потом».
	 *
	 * Строки нет там, где функция не работает: на компьютере, в старых
	 * клиентах и вне Telegram. Пустая кнопка, которая ничего не делает,
	 * хуже её отсутствия.
	 */
	let status = $state<HomeScreenStatus>('unsupported');

	const wa = $derived(telegram.webApp);
	const mobile = $derived(telegram.platform === 'ios' || telegram.platform === 'android');

	$effect(() => {
		if (!wa || !mobile || !telegram.isEmbedded || !wa.checkHomeScreenStatus) return;
		if (!wa.isVersionAtLeast('8.0')) return;

		wa.checkHomeScreenStatus((next) => (status = next));

		// Клиент сообщает об успехе событием: ярлык мог добавиться
		// через системный диалог уже после нажатия.
		const onAdded = () => (status = 'added');
		wa.onEvent('homeScreenAdded', onAdded);
		return () => wa.offEvent('homeScreenAdded', onAdded);
	});

	function add() {
		telegram.haptic.impact('light');
		wa?.addToHomeScreen?.();
	}
</script>

{#if status === 'added'}
	<SettingsRow icon={DeviceMobile} label="На главном экране" value="Добавлено" />
{:else if status === 'missed' || status === 'unknown'}
	<SettingsRow
		icon={DeviceMobile}
		label="Добавить на главный экран"
		hint="Открывать одним касанием, как приложение"
		onclick={add}
	/>
{/if}
