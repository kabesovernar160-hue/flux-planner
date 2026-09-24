import { referralShareUrl } from '$lib/billing/referral';
import { telegram } from '$lib/telegram';

/**
 * Действия с приглашением: поделиться и скопировать.
 *
 * Общие для группы в настройках и карточки в аналитике: окно «Поделиться»
 * и текст сообщения должны быть одни и те же, откуда бы их ни открыли.
 */

/** Окно выбора чата Telegram с готовым сообщением и ссылкой. */
export function shareInvite(link: string): void {
	telegram.haptic.impact('light');
	telegram.openTelegramLink(referralShareUrl(link));
}

/**
 * Скопировать ссылку.
 *
 * Clipboard API есть не во всех WebView Telegram, и на части Android он
 * молча отказывает без жеста пользователя. Запасной путь — выделение
 * во временном поле: старый, но работающий везде.
 */
export async function copyInvite(link: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(link);
		telegram.haptic.notification('success');
		return true;
	} catch {
		const field = document.createElement('textarea');
		field.value = link;
		field.setAttribute('readonly', '');
		field.style.position = 'fixed';
		field.style.opacity = '0';
		document.body.append(field);
		field.select();

		let copied = false;
		try {
			copied = document.execCommand('copy');
		} catch {
			copied = false;
		}
		field.remove();

		telegram.haptic.notification(copied ? 'success' : 'error');
		return copied;
	}
}
