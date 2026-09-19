import { CalendarBlank, ChartLineUp, GearSix, SquaresFour } from 'phosphor-svelte';
import type { Component } from 'svelte';

export type Tab = {
	/** Он же идентификатор: путь уникален, второй ключ был бы лишним. */
	href: string;
	label: string;
	icon: Component;
};

export const TABS: Tab[] = [
	{ href: '/', label: 'Главная', icon: SquaresFour },
	{ href: '/analytics', label: 'Аналитика', icon: ChartLineUp },
	{ href: '/calendar', label: 'Календарь', icon: CalendarBlank },
	{ href: '/settings', label: 'Настройки', icon: GearSix }
];

/**
 * Активный таб по текущему пути.
 *
 * Вложенные экраны (например, список привычек) подсвечивают таб раздела,
 * из которого открылись: иначе при переходе «глубже» панель гасит все
 * пункты, и человек теряет, где он находится.
 */
export function activeTab(pathname: string): string {
	const match = TABS.filter((tab) => tab.href !== '/').find((tab) => pathname.startsWith(tab.href));
	return match?.href ?? '/';
}
