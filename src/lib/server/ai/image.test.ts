import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, readImage, sniffMediaType } from './image';
import { AiError } from './types';

// Тип параметризован явно: BlobPart в конструкторе File требует буфер,
// подкреплённый именно ArrayBuffer, а не общим ArrayBufferLike.
const bytes = (...values: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(values);

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00);

const file = (data: Uint8Array<ArrayBuffer>, type = 'image/jpeg', name = 'photo.jpg') =>
	new File([data], name, { type });

describe('sniffMediaType', () => {
	it('узнаёт JPEG', () => expect(sniffMediaType(JPEG)).toBe('image/jpeg'));
	it('узнаёт PNG', () => expect(sniffMediaType(PNG)).toBe('image/png'));
	it('узнаёт GIF', () => expect(sniffMediaType(GIF)).toBe('image/gif'));
	it('узнаёт WebP', () => expect(sniffMediaType(WEBP)).toBe('image/webp'));

	it('отвергает не-изображение', () => {
		// Начало ELF-заголовка: исполняемый файл, переименованный в .jpg.
		expect(sniffMediaType(bytes(0x7f, 0x45, 0x4c, 0x46))).toBeNull();
	});

	it('отвергает слишком короткий буфер', () => {
		expect(sniffMediaType(bytes(0xff))).toBeNull();
	});

	it('не принимает RIFF без метки WEBP', () => {
		// Обычный WAV начинается так же, отличие — в байтах с восьмого.
		const wav = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45);
		expect(sniffMediaType(wav)).toBeNull();
	});
});

describe('readImage', () => {
	it('принимает корректное изображение', async () => {
		const image = await readImage(file(PNG, 'image/png', 'photo.png'));
		expect(image.mediaType).toBe('image/png');
		expect(image.bytes.length).toBe(PNG.length);
	});

	it('тип берётся из байтов, а не из заголовка клиента', async () => {
		// Клиент заявляет PNG, но внутри JPEG. Доверяем содержимому.
		const image = await readImage(file(JPEG, 'image/png', 'ложь.png'));
		expect(image.mediaType).toBe('image/jpeg');
	});

	it('отвергает файл, который не является изображением', async () => {
		const evil = file(bytes(0x7f, 0x45, 0x4c, 0x46, 0x02), 'image/jpeg', 'virus.jpg');
		await expect(readImage(evil)).rejects.toMatchObject({ code: 'INVALID_IMAGE', status: 400 });
	});

	it('отвергает пустой файл', async () => {
		await expect(readImage(file(new Uint8Array(0)))).rejects.toBeInstanceOf(AiError);
	});

	it('отвергает отсутствующее поле', async () => {
		await expect(readImage(null)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
		await expect(readImage('строка')).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
	});

	it('отвергает слишком большой файл до чтения его в память', async () => {
		const huge = file(new Uint8Array(MAX_IMAGE_BYTES + 1));
		await expect(readImage(huge)).rejects.toMatchObject({
			code: 'IMAGE_TOO_LARGE',
			status: 413
		});
	});
});
