import type { ComponentType, CSSProperties } from 'react';
import { Camera, CheckCircle, ChatText, Wallet } from '@phosphor-icons/react';
import {
	AbsoluteFill,
	Img,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig
} from 'remotion';
import { Backdrop, C, FONTS, Title, useRise } from './Promo';

// Вставка на 5 секунд в середину чужого ролика: без звука, быстрый вход
// и выход, чтобы склейка с любым видео выглядела намеренной.
// Нижние ~400px пустые: в TikTok их закрывает подпись, а QR должен сканироваться.
export const BANNER_DURATION = 150;

type Feature = [ComponentType<{ size: number; weight: 'regular'; color: string }>, string, string, string];

const FEATURES: Feature[] = [
	[Camera, 'Фото тарелки', '→ калории и БЖУ', C.amber],
	[CheckCircle, 'Привычки', 'серии и напоминания', C.mint],
	[Wallet, 'Траты', 'лимит на день', C.sky],
	[ChatText, 'План фразой', '«ужин в 19:00»', C.lavender]
];

const Row = ({ feature, delay }: { feature: Feature; delay: number }) => {
	const [Icon, title, note, color] = feature;
	return (
		<div
			style={{
				...useRise(delay, 50),
				display: 'flex',
				alignItems: 'center',
				gap: 32,
				padding: '30px 36px',
				borderRadius: 40,
				background: 'rgba(255,255,255,0.04)',
				border: '2px solid rgba(255,255,255,0.07)'
			}}
		>
			<div
				style={{
					display: 'grid',
					placeItems: 'center',
					width: 96,
					height: 96,
					borderRadius: 28,
					background: `color-mix(in oklch, ${color} 16%, transparent)`
				}}
			>
				<Icon size={54} weight="regular" color={color} />
			</div>
			<div style={{ fontFamily: 'Geist' }}>
				<div style={{ fontSize: 52, fontWeight: 650, color: C.text, letterSpacing: '-0.02em' }}>
					{title}
				</div>
				<div style={{ fontSize: 36, color: C.dim, marginTop: 4 }}>{note}</div>
			</div>
		</div>
	);
};

/** Общая анимация краёв и QR для обоих форматов. */
const useBannerMotion = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// Вход и выход за треть секунды: вставка режет чужой ролик, долгая
	// анимация на краях съела бы и без того короткие 5 секунд.
	const edge = interpolate(frame, [0, 8, BANNER_DURATION - 8, BANNER_DURATION], [0, 1, 1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp'
	});
	const zoom = interpolate(frame, [0, 8], [1.06, 1], { extrapolateRight: 'clamp' });
	const qr = spring({ frame: frame - 40, fps, config: { damping: 14, stiffness: 130 } });
	const pulse = 1 + Math.sin(frame / 7) * 0.02;

	const qrStyle: CSSProperties = {
		opacity: qr,
		transform: `scale(${(0.7 + qr * 0.3) * pulse})`,
		padding: 22,
		borderRadius: 36,
		background: '#fff',
		boxShadow: `0 30px 90px -20px ${C.lavender}`
	};
	return { shell: { opacity: edge, transform: `scale(${zoom})` } as CSSProperties, qrStyle };
};

const Handle = () => (
	<div style={useRise(46)}>
		<div style={{ fontFamily: 'Geist', fontSize: 40, color: C.dim }}>Бесплатно в Telegram</div>
		<div
			style={{
				fontFamily: 'GeistMono',
				fontWeight: 650,
				fontSize: 50,
				color: C.lavender,
				marginTop: 10,
				letterSpacing: '-0.03em'
			}}
		>
			@fluxplanner_xbot
		</div>
	</div>
);

const Logo = () => (
	<div style={{ ...useRise(0), display: 'flex', alignItems: 'center', gap: 28 }}>
		<Img src={staticFile('app-icon.png')} style={{ width: 120, borderRadius: 30 }} />
		<div>
			<Title style={{ fontSize: 76, textAlign: 'left' }}>Flux Planner</Title>
			<div style={{ fontFamily: 'Geist', fontSize: 38, color: C.dim, marginTop: 6 }}>
				весь день — на одном экране
			</div>
		</div>
	</div>
);

export const Banner = () => {
	const { shell, qrStyle } = useBannerMotion();
	return (
		<AbsoluteFill style={shell}>
			<style>{FONTS}</style>
			<Backdrop />
			<AbsoluteFill style={{ padding: '140px 90px 400px', justifyContent: 'space-between' }}>
				<Logo />

				<div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
					{FEATURES.map((feature, i) => (
						<Row key={feature[1]} feature={feature} delay={6 + i * 6} />
					))}
				</div>

				<div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
					<div style={qrStyle}>
						<Img src={staticFile('qr.svg')} style={{ width: 230, height: 230, display: 'block' }} />
					</div>
					<Handle />
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/** Горизонтальный вариант под YouTube и десктоп: функции столбцом справа. */
export const BannerWide = () => {
	const { shell, qrStyle } = useBannerMotion();
	return (
		<AbsoluteFill style={shell}>
			<style>{FONTS}</style>
			<Backdrop />
			<AbsoluteFill
				style={{ padding: '110px 120px', flexDirection: 'row', alignItems: 'center', gap: 110 }}
			>
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'space-between',
						height: '100%',
						flexShrink: 0
					}}
				>
					<Logo />
					<div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
						<div style={qrStyle}>
							<Img src={staticFile('qr.svg')} style={{ width: 250, height: 250, display: 'block' }} />
						</div>
						<Handle />
					</div>
				</div>
				<div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
					{FEATURES.map((feature, i) => (
						<Row key={feature[1]} feature={feature} delay={6 + i * 6} />
					))}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
