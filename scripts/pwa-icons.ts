/**
 * Иконки приложения на главном экране — из static/app-icon.png.
 *
 * Отдельной зависимости для картинок в проекте нет, поэтому рисует браузер:
 * Playwright уже стоит ради автотестов, а canvas умеет всё нужное —
 * кадрировать, масштабировать с хорошим сглаживанием и размыть фон.
 *
 * Запуск (нужен установленный Chrome или `npx playwright install chromium`):
 *   node scripts/pwa-icons.ts
 *
 * Что получается и почему так:
 *
 * - icon-192.png, icon-512.png — исходная плитка со скруглением
 *   и прозрачными углами: «any» показывается как есть.
 * - apple-touch-icon.png (180) — без прозрачных углов, до краёв: iOS
 *   скругляет сам, а прозрачность заливает чёрным.
 * - icon-maskable-512.png — Android вырезает из квадрата круг или «каплю»;
 *   всё значимое обязано лежать в центральных 80%. Марка уменьшена,
 *   поля заполнены размытым фоном той же плитки — без видимого шва.
 *
 * PNG коммитятся: сборке и серверу этот скрипт не нужен.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SOURCE = 'static/app-icon.png';

/**
 * Отступ кадрирования в пикселях исходника 256×256: за ним кончаются
 * прозрачные углы и светлая кромка плитки.
 */
const CROP_INSET = 24;

interface Target {
	file: string;
	size: number;
	mode: 'tile' | 'bleed' | 'maskable';
}

const TARGETS: Target[] = [
	{ file: 'static/icon-192.png', size: 192, mode: 'tile' },
	{ file: 'static/icon-512.png', size: 512, mode: 'tile' },
	{ file: 'static/apple-touch-icon.png', size: 180, mode: 'bleed' },
	{ file: 'static/icon-maskable-512.png', size: 512, mode: 'maskable' }
];

async function main(): Promise<void> {
	const source = `data:image/png;base64,${readFileSync(SOURCE).toString('base64')}`;
	const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

	try {
		const page = await browser.newPage();

		for (const target of TARGETS) {
			const dataUrl = await page.evaluate(
				async ({ source, size, mode, inset }) => {
					const image = new Image();
					image.src = source;
					await image.decode();

					const canvas = document.createElement('canvas');
					canvas.width = size;
					canvas.height = size;
					const ctx = canvas.getContext('2d')!;
					ctx.imageSmoothingEnabled = true;
					ctx.imageSmoothingQuality = 'high';

					const crop = image.width - inset * 2;

					if (mode === 'tile') {
						ctx.drawImage(image, 0, 0, size, size);
					} else if (mode === 'bleed') {
						ctx.drawImage(image, inset, inset, crop, crop, 0, 0, size, size);
					} else {
						// Марка уменьшается к центру, а поля продолжают края плитки:
						// крайняя строка и столбец растягиваются наружу. Фон плитки —
						// плавный градиент, поэтому шва на границе не видно.
						const inner = Math.round(size * 0.88);
						const o = Math.round((size - inner) / 2);
						const x0 = inset;
						const x1 = inset + crop - 1;
						const edge = (
							sx: number,
							sy: number,
							sw: number,
							sh: number,
							dx: number,
							dy: number,
							dw: number,
							dh: number
						) => ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);

						edge(x0, x0, crop, 1, o, 0, inner, o); // верх
						edge(x0, x1, crop, 1, o, o + inner, inner, size - o - inner); // низ
						edge(x0, x0, 1, crop, 0, o, o, inner); // лево
						edge(x1, x0, 1, crop, o + inner, o, size - o - inner, inner); // право
						edge(x0, x0, 1, 1, 0, 0, o, o);
						edge(x1, x0, 1, 1, o + inner, 0, size - o - inner, o);
						edge(x0, x1, 1, 1, 0, o + inner, o, size - o - inner);
						edge(x1, x1, 1, 1, o + inner, o + inner, size - o - inner, size - o - inner);

						ctx.drawImage(image, x0, x0, crop, crop, o, o, inner, inner);
					}

					return canvas.toDataURL('image/png');
				},
				{ source, size: target.size, mode: target.mode, inset: CROP_INSET }
			);

			writeFileSync(target.file, Buffer.from(dataUrl.split(',')[1], 'base64'));
			console.log(`[icons] ${target.file} ${target.size}×${target.size}`);
		}
	} finally {
		await browser.close();
	}
}

await main();
