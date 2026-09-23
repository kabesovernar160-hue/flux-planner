import type { CSSProperties, ReactNode } from 'react';
import {
	AbsoluteFill,
	Easing,
	Img,
	interpolate,
	Sequence,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig
} from 'remotion';

// Вертикальный ролик ~17 секунд под TikTok / Reels / Shorts.
export const DURATION = 505;

export const C = {
	void: '#0D0D10',
	text: '#FFFFFF',
	dim: '#A0A0AA',
	lavender: '#A58AF4',
	amber: 'oklch(0.8 0.115 68)',
	mint: 'oklch(0.8 0.105 168)',
	sky: 'oklch(0.76 0.1 245)'
};

export const FONTS = `
@font-face { font-family: Geist; font-weight: 100 900; src: url(${staticFile('fonts/geist-cyrillic-wght-normal.woff2')}) format('woff2'); unicode-range: U+0400-04FF; }
@font-face { font-family: Geist; font-weight: 100 900; src: url(${staticFile('fonts/geist-latin-wght-normal.woff2')}) format('woff2'); }
@font-face { font-family: GeistMono; font-weight: 100 900; src: url(${staticFile('fonts/geist-mono-cyrillic-wght-normal.woff2')}) format('woff2'); unicode-range: U+0400-04FF; }
@font-face { font-family: GeistMono; font-weight: 100 900; src: url(${staticFile('fonts/geist-mono-latin-wght-normal.woff2')}) format('woff2'); }
`;

const ease = Easing.bezier(0.32, 0.72, 0, 1);

/** Появление снизу с пружиной; delay в кадрах. */
export const useRise = (delay = 0, distance = 60) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const p = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 120 } });
	return { opacity: p, transform: `translateY(${(1 - p) * distance}px)` } as CSSProperties;
};

/** Плавный вход и выход сцены, чтобы склейки не резали глаз. */
const Fade = ({ len, children }: { len: number; children: ReactNode }) => {
	const frame = useCurrentFrame();
	const opacity = interpolate(frame, [0, 8, len - 10, len], [0, 1, 1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp'
	});
	return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const Backdrop = () => {
	const frame = useCurrentFrame();
	const drift = Math.sin(frame / 60) * 40;
	const blob = (color: string, x: number, y: number, size: number): CSSProperties => ({
		position: 'absolute',
		left: x,
		top: y,
		width: size,
		height: size,
		borderRadius: '50%',
		background: color,
		filter: 'blur(160px)',
		opacity: 0.35
	});
	return (
		<AbsoluteFill style={{ background: C.void, overflow: 'hidden' }}>
			<div style={blob(C.lavender, -200 + drift, 150, 800)} />
			<div style={blob(C.amber, 600 - drift, 1250, 700)} />
			<div style={{ ...blob(C.mint, 500, 600 + drift, 500), opacity: 0.18 }} />
		</AbsoluteFill>
	);
};

export const Title = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
	<div
		style={{
			fontFamily: 'Geist',
			fontWeight: 650,
			fontSize: 92,
			lineHeight: 1.05,
			letterSpacing: '-0.035em',
			color: C.text,
			textAlign: 'center',
			...style
		}}
	>
		{children}
	</div>
);

const Phone = ({ src, style, pan = 0 }: { src: string; style?: CSSProperties; pan?: number }) => (
	<div
		style={{
			width: 600,
			height: 1298,
			borderRadius: 86,
			padding: 16,
			background: 'linear-gradient(160deg, #3a3a45, #16161c 40%, #2a2a32)',
			boxShadow: '0 60px 120px -30px rgba(0,0,0,0.8), 0 0 0 2px rgba(255,255,255,0.06)',
			...style
		}}
	>
		<div style={{ width: '100%', height: '100%', borderRadius: 72, overflow: 'hidden' }}>
			<Img
				src={staticFile(`shots/${src}.png`)}
				style={{ width: '100%', transform: `translateY(${-pan}px)` }}
			/>
		</div>
	</div>
);

export const Chip = ({ color, children }: { color: string; children: ReactNode }) => (
	<span
		style={{
			display: 'inline-block',
			padding: '14px 30px',
			borderRadius: 999,
			fontFamily: 'Geist',
			fontWeight: 600,
			fontSize: 40,
			color,
			background: `color-mix(in oklch, ${color} 16%, transparent)`,
			border: `2px solid color-mix(in oklch, ${color} 35%, transparent)`
		}}
	>
		{children}
	</span>
);

// ── Сцены ───────────────────────────────────────────────────────

const Hook = () => {
	const lines = [
		['Калории — в заметках,', C.amber],
		['траты — в голове,', C.sky],
		['привычки — забыты?', C.mint]
	] as const;
	return (
		<AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 28 }}>
			{lines.map(([text, color], i) => (
				<Title key={text} style={{ ...useRise(i * 14), fontSize: 84 }}>
					{text.split('—')[0]}—<span style={{ color }}>{text.split('—')[1]}</span>
				</Title>
			))}
		</AbsoluteFill>
	);
};

const Brand = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const pop = spring({ frame, fps, config: { damping: 12, stiffness: 140 } });
	return (
		<AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 56 }}>
			<Img
				src={staticFile('app-icon.png')}
				style={{
					width: 280,
					borderRadius: 64,
					transform: `scale(${0.6 + pop * 0.4}) rotate(${(1 - pop) * -12}deg)`,
					opacity: pop,
					boxShadow: `0 40px 120px -20px ${C.lavender}`
				}}
			/>
			<Title style={{ ...useRise(10), fontSize: 120 }}>Flux Planner</Title>
			<div
				style={{
					...useRise(20),
					fontFamily: 'Geist',
					fontSize: 48,
					color: C.dim,
					textAlign: 'center'
				}}
			>
				весь день — на одном экране
			</div>
		</AbsoluteFill>
	);
};

const Showcase = ({ len }: { len: number }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const enter = spring({ frame, fps, config: { damping: 20, stiffness: 90 } });
	// Скриншот ровно в высоту экрана: вместо прокрутки — смена на дневник еды.
	const swap = interpolate(frame, [len / 2 - 8, len / 2 + 8], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing: ease
	});
	const tilt = interpolate(frame, [0, len], [8, -4]);
	return (
		<AbsoluteFill style={{ alignItems: 'center', paddingTop: 150 }}>
			<Title style={{ ...useRise(0), fontSize: 76, marginBottom: 20 }}>
				Еда, привычки и деньги
			</Title>
			<div style={{ ...useRise(8), display: 'flex', gap: 16, marginBottom: 70 }}>
				<Chip color={C.amber}>ккал</Chip>
				<Chip color={C.mint}>привычки</Chip>
				<Chip color={C.sky}>₽</Chip>
			</div>
			<div
				style={{
					position: 'relative',
					transform: `perspective(2000px) rotateX(${tilt}deg) translateY(${(1 - enter) * 900}px)`
				}}
			>
				<Phone src="home" />
				<Phone src="home-food" style={{ position: 'absolute', inset: 0, opacity: swap }} />
			</div>
		</AbsoluteFill>
	);
};

const Phrase = () => {
	const frame = useCurrentFrame();
	const typed = 'ужин в 19:00, 450 борщ, 1,5к такси';
	const shown = typed.slice(0, Math.floor(interpolate(frame, [15, 70], [0, typed.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
	const results = [
		['→ в план', C.lavender, 80],
		['→ в еду', C.amber, 92],
		['→ в траты', C.sky, 104]
	] as const;
	return (
		<AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 60 }}>
			<Title style={{ ...useRise(0), fontSize: 80 }}>
				Пишешь как есть —<br />
				<span style={{ color: C.lavender }}>разберу сам</span>
			</Title>
			<div
				style={{
					...useRise(6),
					width: 920,
					padding: '40px 48px',
					borderRadius: 999,
					border: '2px solid #3a3a45',
					background: 'rgba(255,255,255,0.03)',
					fontFamily: 'Geist',
					fontSize: 46,
					color: C.text,
					minHeight: 60
				}}
			>
				{shown}
				<span style={{ opacity: frame % 20 < 10 ? 1 : 0, color: C.lavender }}>|</span>
			</div>
			<div style={{ display: 'flex', gap: 18 }}>
				{results.map(([label, color, at]) => (
					<div key={label} style={useRise(at, 40)}>
						<Chip color={color}>{label}</Chip>
					</div>
				))}
			</div>
		</AbsoluteFill>
	);
};

const Fan = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const phones = [
		['habits', -14, -330, C.mint, 'Привычки'],
		['analytics', 0, 0, C.amber, 'Аналитика'],
		['calendar', 14, 330, C.sky, 'Календарь']
	] as const;
	return (
		<AbsoluteFill style={{ alignItems: 'center', paddingTop: 170 }}>
			<Title style={{ ...useRise(0), fontSize: 80 }}>Видно, где ты молодец</Title>
			<div style={{ position: 'relative', width: 1080, height: 1180, marginTop: 100 }}>
				{phones.map(([src, rot, x, color, label], i) => {
					const p = spring({ frame: frame - 6 - i * 7, fps, config: { damping: 16, stiffness: 100 } });
					return (
						<div
							key={src}
							style={{
								position: 'absolute',
								left: 540 - 300 * 0.78 + x * p,
								top: 60 + Math.abs(rot) * 6,
								transform: `rotate(${rot * p}deg) scale(0.78)`,
								transformOrigin: 'top center',
								opacity: p,
								zIndex: i === 1 ? 2 : 1
							}}
						>
							<Phone src={src} />
						</div>
					);
				})}
			</div>
			<div style={{ ...useRise(24), display: 'flex', gap: 18, marginTop: -40 }}>
				{phones.map(([src, , , color, label]) => (
					<Chip key={src} color={color}>
						{label}
					</Chip>
				))}
			</div>
		</AbsoluteFill>
	);
};

const Cta = () => {
	const frame = useCurrentFrame();
	const pulse = 1 + Math.sin(frame / 6) * 0.025;
	return (
		<AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 60 }}>
			<Img src={staticFile('app-icon.png')} style={{ ...useRise(0), width: 200, borderRadius: 46 }} />
			<Title style={{ ...useRise(6), fontSize: 104 }}>
				Бесплатно
				<br />
				<span style={{ color: C.lavender }}>в Telegram</span>
			</Title>
			<div
				style={{
					...useRise(14),
					transform: `${useRise(14).transform} scale(${pulse})`,
					padding: '34px 64px',
					borderRadius: 999,
					background: C.lavender,
					color: C.void,
					fontFamily: 'GeistMono',
					fontWeight: 650,
					fontSize: 56,
					boxShadow: `0 30px 90px -20px ${C.lavender}`
				}}
			>
				@fluxplanner_xbot
			</div>
		</AbsoluteFill>
	);
};

// Раскладка по времени: [начало, длина].
const SCENES: [number, number, (len: number) => ReactNode][] = [
	[0, 80, () => <Hook />],
	[75, 70, () => <Brand />],
	[140, 110, (len) => <Showcase len={len} />],
	[245, 110, () => <Phrase />],
	[350, 80, () => <Fan />],
	[425, 80, () => <Cta />]
];

export const Promo = () => (
	<AbsoluteFill style={{ fontFamily: 'Geist' }}>
		<style>{FONTS}</style>
		<Backdrop />
		{SCENES.map(([from, len, render], i) => (
			<Sequence key={i} from={from} durationInFrames={len}>
				<Fade len={len}>{render(len)}</Fade>
			</Sequence>
		))}
	</AbsoluteFill>
);
