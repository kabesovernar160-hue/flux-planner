/**
 * Подготовка фотографии к отправке.
 *
 * Снимок с камеры телефона — это 3–8 мегабайт и сторона под 4000 пикселей.
 * Отправлять его как есть незачем: распознаванию такое разрешение не нужно,
 * а пользователь платит за это секундами ожидания на мобильной сети.
 *
 * Попутно решается вопрос приватности. Пересжатие через canvas отбрасывает
 * EXIF целиком, а вместе с ним — координаты съёмки, модель телефона и время.
 * На сервер уходит только изображение еды.
 */

/** Предел на файл после подготовки. Совпадает с ограничением эндпоинта. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Предел на исходный файл, до декодирования.
 *
 * Проверяется первым: раскодировать в память гигабайтный файл, чтобы потом
 * отказаться его отправлять, — верный способ уронить вкладку на телефоне.
 */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * Сторона, к которой приводится изображение.
 *
 * 1280 пикселей достаточно, чтобы различить компоненты блюда, и это примерно
 * в десять раз меньше байт, чем оригинал с камеры.
 */
const MAX_DIMENSION = 1280;

const JPEG_QUALITY = 0.82;

/** Что принимает эндпоинт. HEIC с айфона браузер конвертирует сам при отрисовке. */
export const ACCEPTED_INPUT_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/heic',
	'image/heif'
];

/** Значение атрибута accept для выбора файла. */
export const FILE_ACCEPT = ACCEPTED_INPUT_TYPES.join(',');

export class ImageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageError';
	}
}

function targetSize(width: number, height: number): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= MAX_DIMENSION) return { width, height };

	const scale = MAX_DIMENSION / longest;
	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function encode(bitmap: ImageBitmap): Promise<Blob> {
	const size = targetSize(bitmap.width, bitmap.height);
	const canvas = document.createElement('canvas');
	canvas.width = size.width;
	canvas.height = size.height;

	const context = canvas.getContext('2d');
	if (!context) throw new ImageError('Браузер не смог обработать изображение');

	context.drawImage(bitmap, 0, 0, size.width, size.height);

	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
	});

	if (!blob) throw new ImageError('Не удалось подготовить изображение');
	return blob;
}

/**
 * Проверка и сжатие выбранного файла.
 *
 * Если пересжатие почему-то не удалось (экзотический формат, отказ canvas),
 * исходный файл отправляется как есть — при условии, что он подходящего типа
 * и помещается в предел. Уронить весь сценарий из-за неудачной оптимизации
 * было бы обиднее, чем отправить лишние байты.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
	if (!file.type.startsWith('image/')) {
		throw new ImageError('Нужна фотография: JPEG, PNG или WebP');
	}

	if (file.size === 0) {
		throw new ImageError('Файл пустой');
	}

	if (file.size > MAX_SOURCE_BYTES) {
		throw new ImageError('Фотография слишком большая');
	}

	try {
		// imageOrientation: from-image разворачивает снимок по EXIF ДО того,
		// как метаданные будут отброшены. Без этого фото с телефона, снятое
		// боком, уехало бы на сервер повёрнутым.
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

		try {
			const blob = await encode(bitmap);
			return new File([blob], 'meal.jpg', { type: 'image/jpeg' });
		} finally {
			bitmap.close();
		}
	} catch (error) {
		if (error instanceof ImageError) throw error;

		if (file.size <= MAX_UPLOAD_BYTES && ACCEPTED_INPUT_TYPES.includes(file.type)) {
			return file;
		}

		throw new ImageError('Не удалось обработать эту фотографию');
	}
}
