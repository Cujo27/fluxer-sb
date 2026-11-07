// SPDX-License-Identifier: AGPL-3.0-or-later

import {ComponentBus} from '@app/features/platform/utils/ComponentBus';
import {usePopout} from '@app/features/ui/hooks/usePopout';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {SoundboardPicker} from '@app/features/voice/components/SoundboardPicker';
import MediaEngine, {useMediaEngineVersion} from '@app/features/voice/engine/MediaEngineFacade';
import {useLingui} from '@lingui/react/macro';
import {MusicNotesIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useEffect, useId, useRef} from 'react';

export const SoundboardButton = observer(({className, iconClassName}: {className?: string; iconClassName?: string}) => {
	const {t} = useLingui();
	useMediaEngineVersion();
	const ref = useRef<HTMLButtonElement>(null);
	const id = useId();
	const {isOpen, openProps} = usePopout(`soundboard-${id}`);
	const connected = MediaEngine.connected;
	useEffect(
		() =>
			ComponentBus.subscribe('SOUNDBOARD_TOGGLE', () => {
				if (!connected || !ref.current?.isConnected || !ref.current.getClientRects().length) return false;
				ref.current.click();
				return true;
			}),
		[connected],
	);
	return (
		<Popout
			{...openProps}
			position="top-start"
			tooltip={t`Open soundboard`}
			render={({onClose}) => <SoundboardPicker onClose={onClose} data-flx="voice.soundboard-button.picker" />}
			data-flx="voice.soundboard-button.popout"
		>
			<button
				ref={ref}
				type="button"
				className={className}
				disabled={!connected}
				aria-label={t`Open soundboard`}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				data-flx="voice.soundboard-button.button"
			>
				<MusicNotesIcon weight="fill" className={iconClassName} size={20} data-flx="voice.soundboard-button.icon" />
			</button>
		</Popout>
	);
});
