import tailwindcss from '@tailwindcss/vite';
import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Telegram открывает Mini App только по HTTPS, поэтому на время отладки
// приложение проксируется через туннель. Vite по умолчанию отклоняет запросы
// с незнакомым заголовком Host — домены туннелей нужно разрешить явно.
// Перечислены конкретные суффиксы, а не allowedHosts: true: полное отключение
// проверки открывает локальный сервер для DNS-rebinding.
const TUNNEL_HOSTS = ['.trycloudflare.com', '.ngrok-free.dev', '.ngrok-free.app', '.ngrok.app'];

/**
 * Куда собираем.
 *
 * Своя сборка под каждый способ развёртывания: на своём сервере нужен обычный
 * Node-процесс (вебхук бота, распознавание, синхронизация), на Vercel — функции.
 * Выбор идёт по переменной, которую Vercel выставляет сам: два конфига или
 * переключение адаптера руками однажды закончатся выкатом не того.
 */
function selectAdapter() {
	if (process.env.VERCEL) {
		// Node-рантайм, а не edge: проверка подписи initData использует
		// node:crypto, а распознавание — SDK, которому нужен полноценный Node.
		return adapterVercel({ runtime: 'nodejs22.x' });
	}

	// Сборка кладётся в build/, запуск — node build. Так приложение одинаково
	// поднимается в Docker, на VPS и в любом PaaS с Node.
	return adapterNode({ out: 'build' });
}

export default defineConfig(({ mode }) => {
	// npm run dev:tunnel запускает vite с --mode tunnel.
	// Через туннель страница отдаётся по https, и клиент HMR обязан идти
	// на wss:443 — иначе браузер заблокирует ws-соединение как смешанный
	// контент, и Vite покажет оверлей «соединение с сервером потеряно».
	const viaTunnel = mode === 'tunnel';

	return {
		/**
		 * На Vercel база всегда удалённая, и нативный модуль libSQL там лишний:
		 * веб-сборка клиента ходит по HTTP и не тянет за собой бинарник под
		 * конкретную платформу, который бандлер функции может не довезти.
		 * В коде при этом остаётся один импорт.
		 */
		resolve: {
			alias: process.env.VERCEL
				? ({ '@libsql/client': '@libsql/client/web' } as Record<string, string>)
				: ({} as Record<string, string>)
		},

		server: {
			allowedHosts: TUNNEL_HOSTS,
			hmr: viaTunnel ? { protocol: 'wss', clientPort: 443 } : undefined
		},

		preview: {
			allowedHosts: TUNNEL_HOSTS
		},

		plugins: [
			tailwindcss(),
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// Не adapter-auto: приложению нужен собственный сервер, а выбор
				// между Node и Vercel делается явно — см. selectAdapter.
				adapter: selectAdapter()
			})
		]
	};
});
