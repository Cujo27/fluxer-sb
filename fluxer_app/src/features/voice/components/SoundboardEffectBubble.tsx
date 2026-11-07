// SPDX-License-Identifier: AGPL-3.0-or-later

import Emoji from '@app/features/emoji/state/Emoji';
import styles from '@app/features/voice/components/Soundboard.module.css';
import type {SoundboardEffect} from '@app/features/voice/state/SoundboardEffects';
import {useLingui} from '@lingui/react/macro';
import {MusicNotesIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

export const SoundboardEffectBubble = observer(({effect}: {effect: SoundboardEffect}) => {
	const {t} = useLingui();
	const emoji = effect.emoji_id ? Emoji.getEmojiById(effect.emoji_id) : null;
	return (
		<span
			className={styles.effectBubble}
			role="img"
			aria-label={t`Playing a soundboard sound`}
			data-flx="voice.soundboard-effect.bubble"
		>
			{emoji ? (
				<img src={emoji.url} alt="" data-flx="voice.soundboard-effect.emoji" />
			) : (
				effect.emoji_name || <MusicNotesIcon size={28} data-flx="voice.soundboard-effect.icon" />
			)}
		</span>
	);
});
