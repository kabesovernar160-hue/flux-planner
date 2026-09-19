import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Отдельный конфиг для тестов, а не блок test в vite.config.ts.
 *
 * Причина в resolve.conditions: рантайм Svelte 5 поставляется в двух
 * вариантах, и под серверным $derived вычисляется единожды при создании
 * класса. Производные значения стора тогда навсегда остались бы нулями,
 * а тесты — зелёными и бессмысленными. Условие browser обязано действовать
 * только на тесты, поэтому конфиг сборки приложения не трогаем.
 */
export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],

	resolve: {
		conditions: ['browser'],
		alias: {
			$lib: here('./src/lib'),
			// Виртуальные модули SvelteKit существуют только внутри его сборки.
			// Серверный код импортирует их на верхнем уровне, поэтому без заглушек
			// он просто не загрузится в тестах.
			'$env/dynamic/private': here('./tests/stubs/env-dynamic-private.ts'),
			'$app/environment': here('./tests/stubs/app-environment.ts')
		}
	},

	test: {
		environment: 'node',
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.test.ts', 'tests/**/*.test.ts']
	}
});
