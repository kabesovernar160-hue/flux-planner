import {
	Barbell,
	BookOpen,
	CheckCircle,
	Drop,
	Footprints,
	Leaf,
	MoonStars,
	PenNib,
	PersonSimpleRun,
	Pill
} from 'phosphor-svelte';
import type { Component } from 'svelte';

/**
 * Реестр иконок привычек.
 *
 * Привычка хранит строковый ключ, а не компонент: в IndexedDB попадает
 * структурированный клон, который не умеет клонировать функции и классы.
 * Разворачивание ключа в компонент происходит только на отрисовке.
 */
export const HABIT_ICONS = {
	barbell: Barbell,
	run: PersonSimpleRun,
	drop: Drop,
	book: BookOpen,
	pill: Pill,
	footprints: Footprints,
	moon: MoonStars,
	leaf: Leaf,
	pen: PenNib,
	check: CheckCircle
} satisfies Record<string, Component>;

export type HabitIconKey = keyof typeof HABIT_ICONS;

export const HABIT_ICON_KEYS = Object.keys(HABIT_ICONS) as HabitIconKey[];

export const DEFAULT_HABIT_ICON: HabitIconKey = 'check';

export function isHabitIconKey(value: unknown): value is HabitIconKey {
	return typeof value === 'string' && value in HABIT_ICONS;
}

/**
 * Иконка по ключу. Неизвестный ключ отдаёт запасную, а не роняет отрисовку:
 * данные могли прийти из синхронизации с более новой версией клиента.
 */
export function habitIcon(key: string): Component {
	return isHabitIconKey(key) ? HABIT_ICONS[key] : HABIT_ICONS[DEFAULT_HABIT_ICON];
}
