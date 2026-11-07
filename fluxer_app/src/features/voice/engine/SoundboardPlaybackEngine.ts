// SPDX-License-Identifier: AGPL-3.0-or-later

import {ResettableStates} from '@app/features/app/state/ResettableStates';
import Authentication from '@app/features/auth/state/Authentication';
import StreamerMode from '@app/features/streamer_mode/state/StreamerMode';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import {VoiceClipPlayer} from '@app/features/voice/engine/VoiceClipPlayer';
import {getEffectiveAudioState} from '@app/features/voice/engine/VoiceEffectiveAudioState';
import ParticipantVolume from '@app/features/voice/state/ParticipantVolume';
import SoundboardEffects, {type SoundboardEffect} from '@app/features/voice/state/SoundboardEffects';
import type {SoundboardSound} from '@app/features/voice/state/SoundboardLibrary';
import SoundboardPreferences from '@app/features/voice/state/SoundboardPreferences';
import VoiceSettings from '@app/features/voice/state/VoiceSettings';

const player = new VoiceClipPlayer();
const previewPlayer = new VoiceClipPlayer();

export const SoundboardPlaybackEngine = {
	async preview(sound: SoundboardSound): Promise<void> {
		previewPlayer.stopAll();
		await previewPlayer.play({
			url: sound.url,
			gain: () => (sound.volume * VoiceSettings.getOutputVolume()) / 100,
			shouldPlay: () => {
				MediaEngine.getMobxSnapshot();
				return !getEffectiveAudioState().effectiveDeaf;
			},
		});
	},
	async play(data: SoundboardEffect & {url: string; sound_volume: number}): Promise<void> {
		const own = Authentication.currentUserId === data.user_id;
		let effectToken = 0;
		await player.play({
			url: data.url,
			onStart: () => {
				effectToken = SoundboardEffects.start(data);
			},
			onEnd: () => SoundboardEffects.stop(data, effectToken),
			gain: () =>
				((((data.sound_volume * Math.max(0, Math.min(100, SoundboardPreferences.volume))) / 100) *
					VoiceSettings.getOutputVolume()) /
					100) *
				(own ? 1 : ParticipantVolume.getVolume(data.user_id) / 100),
			shouldPlay: () => {
				MediaEngine.getMobxSnapshot();
				return (
					MediaEngine.connected &&
					MediaEngine.channelId === data.channel_id &&
					!getEffectiveAudioState().effectiveDeaf &&
					!StreamerMode.shouldDisableSounds &&
					(own || !ParticipantVolume.isLocalMuted(data.user_id))
				);
			},
		});
	},
	stopPreview(): void {
		previewPlayer.stopAll();
	},
	stopAll(): void {
		player.stopAll();
		previewPlayer.stopAll();
	},
};

ResettableStates.register(SoundboardPlaybackEngine, SoundboardPlaybackEngine.stopAll);
