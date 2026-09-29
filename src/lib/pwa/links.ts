/**
 * Имя бота для ссылок из приложения.
 *
 * Совпадает с умолчанием TELEGRAM_BOT_USERNAME на сервере (config.ts)
 * и со ссылкой BOT_APP_LINK в итогах недели. Клиенту переменные сервера
 * недоступны, а ради одной строки отдельный эндпоинт не нужен.
 */
export const BOT_USERNAME = 'fluxplanner_xbot';

/**
 * Бот сразу с кодом входа: /start login отвечает ссылкой и кодом,
 * без приветствия.
 */
export const BOT_LOGIN_LINK = `https://t.me/${BOT_USERNAME}?start=login`;
