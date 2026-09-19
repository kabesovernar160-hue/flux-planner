/** Длина случайного хвоста в байтах. */
const RANDOM_BYTES = 8;

let lastTime = 0;
let counter = 0;

function randomSuffix(): string {
	const cryptoApi = globalThis.crypto;

	if (typeof cryptoApi?.getRandomValues === 'function') {
		const bytes = new Uint8Array(RANDOM_BYTES);
		cryptoApi.getRandomValues(bytes);
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	}

	// Окружение без Web Crypto: в WebView Telegram и в Node 18+ сюда не попадаем.
	return Math.random()
		.toString(36)
		.slice(2, 2 + RANDOM_BYTES * 2);
}

/**
 * Идентификатор записи, сортируемый лексикографически по времени создания.
 *
 * Обычный UUID здесь не годится. getAll() в IndexedDB отдаёт записи в порядке
 * первичного ключа, и на случайных ключах список привычек перетасовывался бы
 * при каждой перезагрузке. Формат «время — счётчик — случайность» даёт
 * стабильный порядок и остаётся уникальным даже для записей, созданных
 * в одну миллисекунду.
 *
 * Время занимает 9 символов в base36 — этого хватает до 5138 года.
 */
export function createId(): string {
	const now = Date.now();

	if (now === lastTime) {
		counter += 1;
	} else {
		lastTime = now;
		counter = 0;
	}

	const time = now.toString(36).padStart(9, '0');
	const sequence = counter.toString(36).padStart(4, '0');

	return `${time}-${sequence}-${randomSuffix()}`;
}
