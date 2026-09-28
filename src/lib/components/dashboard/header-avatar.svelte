<script lang="ts">
	type Props = {
		name: string;
		/** Ссылка на фото из initDataUnsafe.user. Есть не у всех: зависит от приватности. */
		photoUrl?: string;
		size?: number;
	};

	let { name, photoUrl, size = 44 }: Props = $props();

	/**
	 * Фото может не загрузиться: ссылка из Telegram живёт недолго и
	 * отдаётся с его CDN, который бывает недоступен. Тогда показываем
	 * инициал, а не значок битой картинки.
	 */
	let broken = $state(false);

	// Одна буква, а не две: в кружке 44 px две буквы мелкие и читаются
	// как подпись, а не как лицо.
	const initial = $derived(name.trim().charAt(0).toUpperCase() || '?');
</script>

<span
	class="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-lavender/15"
	style="width: {size}px; height: {size}px;"
>
	{#if photoUrl && !broken}
		<img
			src={photoUrl}
			alt=""
			width={size}
			height={size}
			draggable="false"
			decoding="async"
			referrerpolicy="no-referrer"
			onerror={() => (broken = true)}
			class="size-full object-cover select-none"
		/>
	{:else}
		<span
			class="leading-none font-semibold text-lavender"
			style="font-size: {Math.round(size * 0.4)}px;"
			aria-hidden="true">{initial}</span
		>
	{/if}

	<!-- Волосяное кольцо поверх: отделяет аватар от тёмного фона без грубой рамки. -->
	<span
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/12 ring-inset"
	></span>
</span>
