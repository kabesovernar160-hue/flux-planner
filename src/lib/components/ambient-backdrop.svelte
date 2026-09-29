<!--
	Фоновый слой приложения.

	Зафиксирован и выключен из событий (fixed + pointer-events-none) — именно
	поэтому он не участвует в скролле и не вызывает перерисовку при прокрутке.
	Градиентным пятнам нужно давать стеклу что преломлять: на равномерно
	плоском фоне любой glassmorphism выглядит как серая плашка.

	Зерно поверх градиентов убирает бандинг — полосы, в которые распадаются
	плавные тёмные переходы на OLED-экранах телефонов.

	Цвета пятен, затемнение к низу, прозрачность и режим наложения зерна
	берутся из токенов --fx-backdrop-* и --fx-grain-*: в светлой теме пятна
	бледнее, а зерно ложится через multiply — overlay на почти белом фоне
	его не показывает.
-->
<div aria-hidden="true" class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
	<div
		class="absolute inset-0"
		style="
			background:
				radial-gradient(60rem 42rem at 10% -12%, var(--fx-backdrop-1), transparent 62%),
				radial-gradient(44rem 34rem at 98% 6%, var(--fx-backdrop-2), transparent 64%),
				radial-gradient(52rem 40rem at 46% 112%, var(--fx-backdrop-3), transparent 66%),
				radial-gradient(36rem 28rem at -8% 58%, var(--fx-backdrop-4), transparent 64%);
		"
	></div>

	<!--
		Затемнение к низу экрана. Нижняя панель — стекло с блюром, и под ней
		должно быть темнее, чем под шапкой: иначе подписи меню ложатся на
		самое светлое место фона и теряют контраст. Заодно появляется глубина —
		свет сверху, тень снизу, как в комнате с окном.
	-->
	<div
		class="absolute inset-0"
		style="background: linear-gradient(180deg, transparent 55%, var(--fx-backdrop-fade) 100%);"
	></div>

	<div
		class="absolute inset-0"
		style="
			opacity: var(--fx-grain-opacity);
			mix-blend-mode: var(--fx-grain-blend);
			background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E&quot;);
		"
	></div>
</div>
