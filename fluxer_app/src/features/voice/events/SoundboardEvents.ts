// SPDX-License-Identifier: AGPL-3.0-or-later

import {Logger} from '@app/features/platform/utils/AppLogger';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import {SoundboardPlaybackEngine} from '@app/features/voice/engine/SoundboardPlaybackEngine';
import type {SoundboardEffect} from '@app/features/voice/state/SoundboardEffects';
import SoundboardLibrary, {type SoundboardSound} from '@app/features/voice/state/SoundboardLibrary';

const logger = new Logger('SoundboardEvents');

export function handleSoundboardSoundUpsert(data: SoundboardSound): void {
	SoundboardLibrary.upsert(data);
}
export function handleSoundboardSoundDelete(data: {guild_id: string; sound_id: string}): void {
	SoundboardLibrary.remove(data.guild_id, data.sound_id);
}
export function handleVoiceChannelEffect(data: SoundboardEffect & {url?: string; sound_volume?: number}): void {
	if (
		!MediaEngine.connected ||
		MediaEngine.channelId !== data.channel_id ||
		!data.url ||
		typeof data.sound_volume !== 'number'
	)
		return;
	void SoundboardPlaybackEngine.play({...data, url: data.url, sound_volume: data.sound_volume}).catch((error) =>
		logger.warn('Could not play soundboard effect', {error}),
	);
}
