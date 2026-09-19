import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Telegram открывает Mini App только по HTTPS, поэтому на время отладки
// приложение проксируется через туннель. Vite по умолчанию отклоняет запросы
// с незнакомым заголовком Host — домены туннелей нужно разрешить явно.
// Перечислены конкретные суффиксы, а не allowedHosts: true: полное отключение
// проверки открывает локальный сервер для DNS-rebinding.
const TUNNEL_HOSTS = ['.trycloudflare.com', '.ngrok-free.dev', '.ngrok-free.app', '.ngrok.app'];

export default defineConfig(({ mode }) => {
	// npm run dev:tunnel запускает vite с --mode tunnel.
	// Через туннель страница отдаётся по https, и клиент HMR обязан идти
	// на wss:443 — иначе браузер заблокирует ws-соединение как смешанный
	// контент, и Vite покажет оверлей «соединение с сервером потеряно».
	const viaTunnel = mode === 'tunnel';

	return {
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

				// Node-адаптер, а не adapter-auto: приложению нужен собственный
				// сервер (вебхук бота, распознавание, синхронизация), и он должен
				// одинаково подниматься в Docker, на VPS и в любом PaaS.
				// Сборка кладётся в build/, запуск — node build.
				adapter: adapter({ out: 'build' })
			})
		]
	};
});
