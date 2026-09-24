// Озвучка баннера через ElevenLabs.
//
//   node promo/voice.mjs              — пробы несколькими голосами в public/voice/try-*.mp3
//   node promo/voice.mjs <voice_id>   — финальная дорожка public/voice/banner.mp3
//
// Ключ — ELEVENLABS_API_KEY в .env корня проекта.
import { mkdirSync, writeFileSync } from 'node:fs';

try {
	process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
	/* ключ может прийти из окружения процесса */
}

const KEY = process.env.ELEVENLABS_API_KEY?.trim();
if (!KEY) throw new Error('Нет ELEVENLABS_API_KEY в .env');

// Имя приложения написано по-русски: иначе модель читает его по-английски
// с другой интонацией посреди русской фразы.
export const TEXT =
	'Калории по фото, привычки и траты — всё в одном месте. Флакс Пла́ннер — в Телеграме!';

// Молодые мягкие женские голоса из стандартной библиотеки ElevenLabs.
const CANDIDATES = ['Jessica', 'Sarah', 'Lily', 'Alice', 'Laura'];

const OUT = new URL('./public/voice/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const api = (path, init = {}) =>
	fetch(`https://api.elevenlabs.io${path}`, {
		...init,
		headers: { 'xi-api-key': KEY, 'content-type': 'application/json', ...init.headers }
	});

async function speak(voiceId, file) {
	const response = await api(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
		method: 'POST',
		body: JSON.stringify({
			text: TEXT,
			model_id: 'eleven_multilingual_v2',
			// Чуть живее и теплее стандартных настроек, скорость — чтобы влезть в 5 секунд.
			voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, speed: 1.08 }
		})
	});
	if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
	writeFileSync(new URL(file, OUT), Buffer.from(await response.arrayBuffer()));
	console.log('saved', file);
}

const chosen = process.argv[2];
if (chosen) {
	await speak(chosen, 'banner.mp3');
} else {
	const { voices } = await api('/v1/voices').then((r) => r.json());
	for (const name of CANDIDATES) {
		const voice = voices?.find((v) => v.name.startsWith(name));
		if (!voice) continue;
		await speak(voice.voice_id, `try-${name.toLowerCase()}-${voice.voice_id}.mp3`);
	}
}
