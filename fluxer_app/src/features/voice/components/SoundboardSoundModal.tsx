// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {EmojiPickerPopout} from '@app/features/emoji/components/popouts/EmojiPickerPopout';
import Emoji from '@app/features/emoji/state/Emoji';
import Guilds from '@app/features/guild/state/Guilds';
import {formatFileSize} from '@app/features/messaging/utils/FileUtils';
import {readBlobAsDataUrl} from '@app/features/platform/utils/BlobDataUrl';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Slider} from '@app/features/ui/components/Slider';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {openEntranceSoundTrimmerModal} from '@app/features/voice/components/EntranceSoundTrimmerModal';
import styles from '@app/features/voice/components/Soundboard.module.css';
import {SoundboardPlaybackEngine} from '@app/features/voice/engine/SoundboardPlaybackEngine';
import SoundboardLibrary, {type SoundboardSound} from '@app/features/voice/state/SoundboardLibrary';
import {
	detectSoundboardAudioContentType,
	normalizeSoundboardAudioContentType,
	SOUNDBOARD_ACCEPTED_FILE_TYPES,
	SOUNDBOARD_MAX_BYTES,
	SOUNDBOARD_MAX_DURATION_MS,
	SOUNDBOARD_NAME_MAX_LENGTH,
	SOUNDBOARD_NAME_MIN_LENGTH,
	SOUNDBOARD_UPLOAD_MAX_BYTES,
	soundboardAudioContentTypeFromFilename,
} from '@fluxer/constants/src/SoundboardConstants';
import {Trans, useLingui} from '@lingui/react/macro';
import {PlayIcon, SmileyIcon, UploadSimpleIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

const SoundboardSoundModal = observer(({guildId, sound}: {guildId: string; sound?: SoundboardSound}) => {
	const {t, i18n} = useLingui();
	const guild = Guilds.getGuild(guildId);
	const maxBytes = guild?.maxSoundboardSize ?? SOUNDBOARD_MAX_BYTES;
	const maxDurationMs = guild?.maxSoundboardDurationMs ?? SOUNDBOARD_MAX_DURATION_MS;
	const maxDurationSeconds = maxDurationMs / 1000;
	const sizeLimit = formatFileSize(i18n.locale, maxBytes);
	const [name, setName] = useState(sound?.name ?? '');
	const [volume, setVolume] = useState((sound?.volume ?? 1) * 100);
	const [emojiId, setEmojiId] = useState<string | null>(sound?.emoji_id ?? null);
	const [emojiName, setEmojiName] = useState<string | null>(sound?.emoji_name ?? null);
	const [audio, setAudio] = useState<string | null>(null);
	const [filename, setFilename] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [reading, setReading] = useState(false);
	useEffect(() => () => SoundboardPlaybackEngine.stopPreview(), []);
	const close = () => ModalCommands.popByType(SoundboardSoundModal);
	const chooseFile = async (file: File) => {
		setError(null);
		if (file.size > SOUNDBOARD_UPLOAD_MAX_BYTES) {
			setError(t`Choose an audio file under 25 MiB.`);
			return;
		}
		setReading(true);
		try {
			const expectedType = soundboardAudioContentTypeFromFilename(file.name);
			const detectedType = detectSoundboardAudioContentType(new Uint8Array(await file.slice(0, 512).arrayBuffer()));
			if (
				!expectedType ||
				detectedType !== expectedType ||
				(file.type &&
					file.type !== 'application/octet-stream' &&
					normalizeSoundboardAudioContentType(file.type) !== expectedType)
			) {
				setError(
					t`Choose a supported MP3, OGG, or WAV audio file. Renamed files and other media formats are not supported.`,
				);
				return;
			}
			if (!name) setName(file.name.replace(/\.[^.]+$/, '').slice(0, SOUNDBOARD_NAME_MAX_LENGTH));
			openEntranceSoundTrimmerModal({
				sourceFile: file,
				title: t`Trim sound`,
				maxBytes,
				maxDurationMs,
				onConfirm: async ({blob}) => {
					setAudio(await readBlobAsDataUrl(blob));
					setFilename(file.name);
				},
			});
		} catch {
			setError(t`Could not read this audio file.`);
		} finally {
			setReading(false);
		}
	};
	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			await SoundboardLibrary.save(
				guildId,
				{name: name.trim(), volume: volume / 100, emoji_id: emojiId, emoji_name: emojiName},
				audio ?? undefined,
				sound?.sound_id,
			);
			close();
		} catch {
			setError(t`Could not save sound. Check your permissions and available sound slots, then try again.`);
		} finally {
			setSaving(false);
		}
	};
	const emoji = emojiId ? Emoji.getGuildEmoji(guildId).find((item) => item.id === emojiId) : null;
	return (
		<Modal.Root size="small" onClose={close} data-flx="voice.soundboard-sound-modal.root">
			<Modal.Header
				title={sound ? t`Edit sound` : t`Upload a sound`}
				onClose={close}
				data-flx="voice.soundboard-sound-modal.header"
			/>
			<Modal.Content padding="default" data-flx="voice.soundboard-sound-modal.content">
				<div className={styles.form} data-flx="voice.soundboard-sound-modal.form">
					{!sound && (
						<>
							<p data-flx="voice.soundboard-sound-modal.help">
								<Trans>
									Choose an MP3, OGG, or WAV clip up to {maxDurationSeconds} seconds and {sizeLimit} after trimming.
								</Trans>
							</p>
							<label className={styles.upload} data-flx="voice.soundboard-sound-modal.upload">
								<UploadSimpleIcon size={24} data-flx="voice.soundboard-sound-modal.upload-icon" />
								{filename || t`Choose an audio file`}
								<input
									type="file"
									accept={SOUNDBOARD_ACCEPTED_FILE_TYPES}
									disabled={saving || reading}
									onChange={(event) => {
										const file = event.target.files?.[0];
										event.target.value = '';
										if (file) void chooseFile(file);
									}}
									data-flx="voice.soundboard-sound-modal.file"
								/>
							</label>
						</>
					)}
					<Input
						label={t`Sound name`}
						value={name}
						onChange={(event) => setName(event.target.value)}
						maxLength={SOUNDBOARD_NAME_MAX_LENGTH}
						minLength={SOUNDBOARD_NAME_MIN_LENGTH}
						disabled={saving}
						autoFocus
						data-flx="voice.soundboard-sound-modal.name"
					/>
					<div className={styles.formRow} data-flx="voice.soundboard-sound-modal.emoji-row">
						<span data-flx="voice.soundboard-sound-modal.emoji-label">
							<Trans>Related emoji</Trans>
						</span>
						<Popout
							position="bottom-end"
							render={({onClose}) => (
								<EmojiPickerPopout
									channelId={null}
									roleIconGuildId={guildId}
									onClose={onClose}
									handleSelect={(selected) => {
										setEmojiId(selected.id ?? null);
										setEmojiName(selected.id ? null : (selected.surrogates ?? null));
									}}
									data-flx="voice.soundboard-sound-modal.emoji-picker"
								/>
							)}
							data-flx="voice.soundboard-sound-modal.emoji-popout"
						>
							<button
								type="button"
								className={styles.emojiButton}
								aria-label={t`Choose related emoji`}
								disabled={saving}
								data-flx="voice.soundboard-sound-modal.emoji-button"
							>
								{emoji ? (
									<img src={emoji.url} alt={emoji.name} data-flx="voice.soundboard-sound-modal.custom-emoji" />
								) : (
									emojiName || <SmileyIcon size={28} data-flx="voice.soundboard-sound-modal.smiley" />
								)}
							</button>
						</Popout>
						{(emojiId || emojiName) && (
							<Button
								variant="ghost"
								small
								onClick={() => {
									setEmojiId(null);
									setEmojiName(null);
								}}
								data-flx="voice.soundboard-sound-modal.clear-emoji"
							>
								<Trans>Remove</Trans>
							</Button>
						)}
					</div>
					<div data-flx="voice.soundboard-sound-modal.volume-label">
						<Trans>Sound volume: {Math.round(volume)}%</Trans>
					</div>
					<Slider
						value={volume}
						defaultValue={100}
						factoryDefaultValue={100}
						onValueChange={setVolume}
						minValue={0}
						maxValue={100}
						ariaLabel={t`Sound volume`}
						disabled={saving}
						data-flx="voice.soundboard-sound-modal.volume"
					/>
					{(sound || audio) && (
						<Button
							variant="secondary"
							leftIcon={<PlayIcon data-flx="voice.soundboard-sound-modal.preview-icon" />}
							onClick={() => {
								void SoundboardPlaybackEngine.preview({
									...sound,
									sound_id: sound?.sound_id ?? 'preview',
									name,
									url: audio ?? sound!.url,
									volume: volume / 100,
									emoji_id: emojiId,
									emoji_name: emojiName,
									available: true,
								}).catch(() => setError(t`Could not preview this sound.`));
							}}
							data-flx="voice.soundboard-sound-modal.preview"
						>
							<Trans>Preview</Trans>
						</Button>
					)}
					{error && (
						<p role="alert" className={styles.error} data-flx="voice.soundboard-sound-modal.error">
							{error}
						</p>
					)}
				</div>
			</Modal.Content>
			<Modal.Footer data-flx="voice.soundboard-sound-modal.footer">
				<Button variant="secondary" onClick={close} disabled={saving} data-flx="voice.soundboard-sound-modal.cancel">
					<Trans>Cancel</Trans>
				</Button>
				<Button
					onClick={() => void save()}
					submitting={saving}
					disabled={reading || name.trim().length < SOUNDBOARD_NAME_MIN_LENGTH || (!sound && !audio)}
					data-flx="voice.soundboard-sound-modal.save"
				>
					{sound ? t`Save changes` : t`Upload sound`}
				</Button>
			</Modal.Footer>
		</Modal.Root>
	);
});

export function openSoundboardSoundModal(guildId: string, sound?: SoundboardSound): void {
	ModalCommands.push(
		ModalCommands.modal(() => (
			<SoundboardSoundModal guildId={guildId} sound={sound} data-flx="voice.soundboard-sound-modal.instance" />
		)),
	);
}
