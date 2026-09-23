<!--
	Фоновый слой приложения.

	Зафиксирован и выключен из событий (fixed + pointer-events-none) — именно
	поэтому он не участвует в скролле и не вызывает перерисовку при прокрутке.
	Градиентным пятнам нужно давать стеклу что преломлять: на равномерно
	плоском фоне любой glassmorphism выглядит как серая плашка.

	Зерно поверх градиентов убирает бандинг — полосы, в которые распадаются
	плавные тёмные переходы на OLED-экранах телефонов.
-->
<div aria-hidden="true" class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
	<div
		class="absolute inset-0"
		style="
			background:
				radial-gradient(60rem 42rem at 10% -12%, oklch(0.7022 0.1527 293.82 / 0.16), transparent 62%),
				radial-gradient(44rem 34rem at 98% 6%, oklch(0.8 0.115 68 / 0.07), transparent 64%),
				radial-gradient(52rem 40rem at 46% 112%, oklch(0.7022 0.1527 293.82 / 0.08), transparent 66%);
		"
	></div>

	<div
		class="absolute inset-0 opacity-[0.035] mix-blend-overlay"
		style="
			background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E&quot;);
		"
	></div>
</div>
