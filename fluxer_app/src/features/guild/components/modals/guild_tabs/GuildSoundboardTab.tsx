// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import Emoji from '@app/features/emoji/state/Emoji';
import Guilds from '@app/features/guild/state/Guilds';
import {formatFileSize} from '@app/features/messaging/utils/FileUtils';
import Permission from '@app/features/permissions/state/Permission';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import Users from '@app/features/user/state/Users';
import styles from '@app/features/voice/components/Soundboard.module.css';
import {openSoundboardSoundModal} from '@app/features/voice/components/SoundboardSoundModal';
import {SoundboardPlaybackEngine} from '@app/features/voice/engine/SoundboardPlaybackEngine';
import SoundboardLibrary, {type SoundboardSound} from '@app/features/voice/state/SoundboardLibrary';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {
	SOUNDBOARD_MAX_BYTES,
	SOUNDBOARD_MAX_DURATION_MS,
	SOUNDBOARD_MAX_SOUNDS,
} from '@fluxer/constants/src/SoundboardConstants';
import {Trans, useLingui} from '@lingui/react/macro';
import {MusicNotesIcon, PencilSimpleIcon, PlayIcon, TrashIcon, UploadSimpleIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

const GuildSoundboardTab = observer(({guildId}: {guildId: string}) => {
	const {t, i18n} = useLingui();
	const guild = Guilds.getGuild(guildId);
	const maxSounds = guild?.maxSoundboardSounds ?? SOUNDBOARD_MAX_SOUNDS;
	const maxDurationSeconds = (guild?.maxSoundboardDurationMs ?? SOUNDBOARD_MAX_DURATION_MS) / 1000;
	const sizeLimit = formatFileSize(i18n.locale, guild?.maxSoundboardSize ?? SOUNDBOARD_MAX_BYTES);
	const [search, setSearch] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		setLoading(true);
		void SoundboardLibrary.loadGuild(guildId)
			.catch(() => {
				if (active) setError(t`Could not load sounds. Reopen settings to try again.`);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
			SoundboardPlaybackEngine.stopPreview();
		};
	}, [guildId, i18n.locale]);
	const sounds = SoundboardLibrary.guildSounds[guildId] ?? [];
	const canCreate = Permission.can(Permissions.CREATE_EXPRESSIONS, {guildId});
	const canManage = Permission.can(Permissions.MANAGE_EXPRESSIONS, {guildId});
	const userId = Users.getCurrentUser()?.id;
	const remove = (sound: SoundboardSound) =>
		ModalCommands.push(
			ModalCommands.modal(() => (
				<ConfirmModal
					title={t`Delete sound`}
					description={t`Delete “${sound.name}”? This cannot be undone.`}
					primaryText={t`Delete sound`}
					primaryVariant="danger"
					onPrimary={async () => {
						try {
							await SoundboardLibrary.delete(guildId, sound.sound_id);
						} catch {
							setError(t`Could not delete sound. Try again.`);
							throw new Error('Sound deletion failed');
						}
					}}
					data-flx="guild.soundboard-tab.delete-confirm"
				/>
			)),
		);
	return (
		<div className={styles.settings} data-flx="guild.soundboard-tab.root">
			<div className={styles.settingsHeader} data-flx="guild.soundboard-tab.header">
				<h2 data-flx="guild.soundboard-tab.title">
					<Trans>Soundboard</Trans>
				</h2>
				<Button
					disabled={!canCreate || sounds.length >= maxSounds || loading}
					leftIcon={<UploadSimpleIcon data-flx="guild.soundboard-tab.upload-icon" />}
					onClick={() => openSoundboardSoundModal(guildId)}
					data-flx="guild.soundboard-tab.upload"
				>
					<Trans>Upload sound</Trans>
				</Button>
			</div>
			<p data-flx="guild.soundboard-tab.description">
				<Trans>
					Add MP3, OGG, or WAV sounds for voice channels. Clips can be up to {maxDurationSeconds} seconds and{' '}
					{sizeLimit} after trimming.
				</Trans>
			</p>
			<p data-flx="guild.soundboard-tab.quota">
				<Trans>
					{sounds.length} of {maxSounds} sound slots used
				</Trans>
			</p>
			<Input
				value={search}
				onChange={(event) => setSearch(event.target.value)}
				placeholder={t`Search sounds`}
				aria-label={t`Search sounds`}
				data-flx="guild.soundboard-tab.search"
			/>
			{error && (
				<p className={styles.error} role="alert" data-flx="guild.soundboard-tab.error">
					{error}
				</p>
			)}
			{loading && (
				<p role="status" data-flx="guild.soundboard-tab.loading">
					<Trans>Loading sounds…</Trans>
				</p>
			)}
			{!loading && !sounds.length && (
				<p data-flx="guild.soundboard-tab.empty">
					<Trans>No sounds yet. Upload a sound to get started.</Trans>
				</p>
			)}
			<div className={styles.list} data-flx="guild.soundboard-tab.list">
				{sounds
					.filter((sound) => sound.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
					.map((sound) => {
						const editable = canManage || (canCreate && sound.user_id === userId);
						const emoji = sound.emoji_id
							? Emoji.getGuildEmoji(guildId).find((item) => item.id === sound.emoji_id)
							: null;
						return (
							<div key={sound.sound_id} className={styles.row} data-flx="guild.soundboard-tab.row">
								<span className={styles.soundEmoji} data-flx="guild.soundboard-tab.emoji">
									{emoji ? (
										<img src={emoji.url} alt={emoji.name} data-flx="guild.soundboard-tab.custom-emoji" />
									) : (
										sound.emoji_name || <MusicNotesIcon data-flx="guild.soundboard-tab.music-icon" />
									)}
								</span>
								<div className={styles.rowName} data-flx="guild.soundboard-tab.name">
									{sound.name}
									<small data-flx="guild.soundboard-tab.creator">
										{`${sound.user?.username ?? Users.getUser(sound.user_id ?? '')?.username ?? t`Unknown user`} · ${Math.round(sound.volume * 100)}%`}
									</small>
								</div>
								<div className={styles.rowActions} data-flx="guild.soundboard-tab.actions">
									<button
										type="button"
										className={styles.iconButton}
										aria-label={t`Preview ${sound.name}`}
										onClick={() => {
											void SoundboardPlaybackEngine.preview(sound).catch(() => setError(t`Could not preview sound.`));
										}}
										data-flx="guild.soundboard-tab.preview"
									>
										<PlayIcon size={20} data-flx="guild.soundboard-tab.play-icon" />
									</button>
									{editable && (
										<>
											<button
												type="button"
												className={styles.iconButton}
												aria-label={t`Edit ${sound.name}`}
												onClick={() => openSoundboardSoundModal(guildId, sound)}
												data-flx="guild.soundboard-tab.edit"
											>
												<PencilSimpleIcon size={20} data-flx="guild.soundboard-tab.edit-icon" />
											</button>
											<button
												type="button"
												className={styles.iconButton}
												aria-label={t`Delete ${sound.name}`}
												onClick={() => remove(sound)}
												data-flx="guild.soundboard-tab.delete"
											>
												<TrashIcon size={20} data-flx="guild.soundboard-tab.delete-icon" />
											</button>
										</>
									)}
								</div>
							</div>
						);
					})}
			</div>
		</div>
	);
});

export default GuildSoundboardTab;
