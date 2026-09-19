/**
 * Заглушка $env/dynamic/private для тестов.
 *
 * Модуль генерирует SvelteKit при сборке, и вне его окружения импорт
 * не разрешается. Тестам достаточно обычных переменных процесса.
 */
export const env: Record<string, string | undefined> = process.env;
