import { AiError, type AnalyzableImage } from './types';

/** Предел на изображение. Совпадает с ограничением vision-запроса Claude. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
	if (bytes.length < offset + signature.length) return false;
	return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Определение типа по сигнатуре файла.
 *
 * Заголовок Content-Type присылает клиент, и подделать его тривиально:
 * достаточно назвать исполняемый файл картинкой. Тип берём из самих байтов,
 * а заявленному значению не доверяем.
 */
export function sniffMediaType(bytes: Uint8Array): AllowedMediaType | null {
	// JPEG: FF D8 FF
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

	// GIF: "GIF87a" или "GIF89a"
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';

	// WEBP: "RIFF" .... "WEBP" — четыре байта длины между сигнатурами.
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	) {
		return 'image/webp';
	}

	return null;
}

/**
 * Разбор и проверка загруженного файла.
 *
 * Размер проверяется до чтения содержимого в память: иначе достаточно
 * отправить гигабайтный файл, чтобы положить процесс.
 */
export async function readImage(file: unknown): Promise<AnalyzableImage> {
	if (!(file instanceof File) || file.size === 0) {
		throw new AiError('INVALID_IMAGE', 'Не удалось прочитать изображение', 400);
	}

	if (file.size > MAX_IMAGE_BYTES) {
		const limitMb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
		throw new AiError('IMAGE_TOO_LARGE', `Изображение больше ${limitMb} МБ`, 413);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	const mediaType = sniffMediaType(bytes);

	if (!mediaType) {
		throw new AiError(
			'INVALID_IMAGE',
			'Формат не поддерживается: нужен JPEG, PNG, WebP или GIF',
			400
		);
	}

	return { bytes, mediaType };
}
