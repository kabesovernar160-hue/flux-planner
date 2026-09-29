/**
 * Кривая cubic-bezier для JS-переходов Svelte.
 *
 * CSS-анимации проекта идут по одной кривой — ease-flux. Переходы Svelte
 * (crossfade, flip) принимают функцию, а не строку, и встроенные cubicOut
 * и quintOut заметно отличаются по характеру: строка, уехавшая в «Сделано»,
 * двигалась бы не так, как всё остальное на экране. Поэтому та же кривая
 * собрана здесь функцией.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;

	const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
	const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
	const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

	/** Параметр t, при котором кривая проходит через x. */
	function solve(x: number): number {
		// Ньютон сходится за несколько шагов почти везде…
		let t = x;
		for (let step = 0; step < 8; step++) {
			const error = sampleX(t) - x;
			if (Math.abs(error) < 1e-6) return t;
			const slope = slopeX(t);
			if (Math.abs(slope) < 1e-6) break;
			t -= error / slope;
		}

		// …а на плоских участках, где производная почти ноль, надёжнее деление пополам.
		let low = 0;
		let high = 1;
		t = x;
		for (let step = 0; step < 40; step++) {
			const value = sampleX(t);
			if (Math.abs(value - x) < 1e-6) return t;
			if (value < x) low = t;
			else high = t;
			t = (low + high) / 2;
		}
		return t;
	}

	return (x: number) => {
		if (x <= 0) return 0;
		if (x >= 1) return 1;
		return sampleY(solve(x));
	};
}

/** То же, что --fx-ease в layout.css. */
export const fluxEase = cubicBezier(0.32, 0.72, 0, 1);
