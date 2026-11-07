// SPDX-License-Identifier: AGPL-3.0-or-later

import {Slider} from '@app/features/ui/components/Slider';
import SoundboardPreferences from '@app/features/voice/state/SoundboardPreferences';
import {Trans, useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';

export const SoundboardVolumeSettings = observer(() => {
	const {t} = useLingui();
	return (
		<div data-flx="voice.soundboard-volume-settings.root">
			<p data-flx="voice.soundboard-volume-settings.help">
				<Trans>Control how loud soundboard sounds play for you. Set to 0% to mute all soundboard sounds.</Trans>
			</p>
			<Slider
				value={SoundboardPreferences.volume}
				defaultValue={100}
				onValueChange={SoundboardPreferences.setVolume}
				minValue={0}
				maxValue={100}
				ariaLabel={t`Soundboard volume`}
				factoryDefaultValue={100}
				showResetButton
				onReset={() => SoundboardPreferences.setVolume(100)}
				data-flx="voice.soundboard-volume-settings.slider"
			/>
		</div>
	);
});
