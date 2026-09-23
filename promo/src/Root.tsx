import { Composition } from 'remotion';
import { Promo, DURATION } from './Promo';
import { Banner, BANNER_DURATION } from './Banner';

export const Root = () => (
	<>
		<Composition
			id="Promo"
			component={Promo}
			durationInFrames={DURATION}
			fps={30}
			width={1080}
			height={1920}
		/>
		<Composition
			id="Banner"
			component={Banner}
			durationInFrames={BANNER_DURATION}
			fps={30}
			width={1080}
			height={1920}
		/>
	</>
);
