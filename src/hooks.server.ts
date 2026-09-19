import { building, dev } from '$app/environment';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { getConfig, validateConfig } from '$lib/server/config';
import { ensureSchema } from '$lib/server/db/client';

/**
 * Старт сервера и обработка каждого запроса.
 *
 * Три задачи, которые раньше не делал никто: проверить конфигурацию до первого
 * запроса, подготовить схему базы и оставить в логах достаточно, чтобы разбирать
 * инциденты не по рассказам пользователей.
 */

/**
 * Хук инициализации выполняется один раз до первого запроса.
 *
 * Здесь приложение либо честно падает с понятным текстом, либо дальше работает
 * с проверенной конфигурацией. Молча подняться с пустым токеном бота — худший
 * сценарий: снаружи всё «работает», а внутри не проходит ни одна авторизация.
 */
export const init: ServerInit = async () => {
	// Во время сборки хук тоже выполняется: пререндер поднимает сервер, чтобы
	// отрисовать статические страницы. Проверять там продакшен-конфигурацию
	// нечего — на машине сборщика нет ни базы, ни токенов, и падение означало бы
	// невозможность собрать приложение без боевых секретов.
	if (building) return;

	const config = getConfig();
	const problems = validateConfig(config);

	for (const problem of problems) {
		const prefix = problem.level === 'fatal' ? 'ОШИБКА' : 'внимание';
		console[problem.level === 'fatal' ? 'error' : 'warn'](
			`[config] ${prefix}: ${problem.variable} — ${problem.message}`
		);
	}

	const fatal = problems.filter((problem) => problem.level === 'fatal');
	if (fatal.length > 0) {
		// В разработке ничего фатального быть не может (см. validateConfig),
		// поэтому сюда попадает только продакшен с неполной конфигурацией.
		throw new Error(
			`Приложение не настроено: ${fatal.map((problem) => problem.variable).join(', ')}`
		);
	}

	try {
		await ensureSchema();
		console.info('[db] схема готова');
	} catch (error) {
		// Без базы приложение бесполезно, и запускаться в таком виде нельзя:
		// иначе каждый запрос будет падать поодиночке, а причина останется
		// в одном давнем сообщении.
		console.error('[db] не удалось подготовить схему', error);
		throw error;
	}
};

/**
 * Заголовки безопасности.
 *
 * frame-ancestors разрешает Telegram: веб-клиент открывает Mini App внутри
 * iframe, и запрет на встраивание просто сломал бы приложение на десктопе.
 * Скрипт SDK грузится с telegram.org — он тоже должен быть в списке.
 *
 * В разработке заголовки не ставятся: Vite отдаёт инлайновые скрипты и держит
 * websocket, и CSP отключила бы горячую перезагрузку.
 */
const CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' https://telegram.org",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self'",
	'frame-ancestors https://web.telegram.org https://*.telegram.org',
	"base-uri 'self'",
	"form-action 'self'",
	"object-src 'none'"
].join('; ');

function applySecurityHeaders(response: Response): void {
	if (dev) return;

	response.headers.set('content-security-policy', CSP);
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	response.headers.set('permissions-policy', 'camera=(self), geolocation=(), microphone=()');
}

/** Пути, которые не стоит писать в лог: они ходят часто и ничего не говорят. */
const QUIET_PATHS = ['/api/health'];

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = crypto.randomUUID().slice(0, 8);
	const started = Date.now();

	// Идентификатор доезжает до клиента: по нему можно связать жалобу
	// пользователя с конкретной строкой в логах.
	event.locals.requestId = requestId;

	const response = await resolve(event);

	response.headers.set('x-request-id', requestId);
	applySecurityHeaders(response);

	const isApi = event.url.pathname.startsWith('/api/');
	const quiet = QUIET_PATHS.includes(event.url.pathname);

	// Логируются только API и ошибки: запись каждой отданной картинки
	// превращает журнал в шум, в котором не найти инцидент.
	if ((isApi && !quiet) || response.status >= 500) {
		// В путь намеренно не попадает строка запроса: там бывают
		// пользовательские данные, а журналы живут дольше и видны шире.
		console.info(
			`[http] ${requestId} ${event.request.method} ${event.url.pathname} ` +
				`${response.status} ${Date.now() - started}ms`
		);
	}

	return response;
};

/**
 * Необработанная ошибка.
 *
 * Наружу уходит только идентификатор: по нему поддержка найдёт запись в логах,
 * а пользователь не увидит ни стектрейса, ни внутренних подробностей.
 */
export const handleError: HandleServerError = ({ error, event, status }) => {
	const requestId = event.locals.requestId ?? 'unknown';

	console.error(`[error] ${requestId} ${event.url.pathname} ${status}`, error);

	return {
		message: 'Что-то пошло не так. Попробуйте ещё раз',
		requestId
	};
};
