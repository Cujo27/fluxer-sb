// SPDX-License-Identifier: AGPL-3.0-or-later

import Emoji from '@app/features/emoji/state/Emoji';
import {GuildIcon} from '@app/features/guild/components/popouts/GuildIcon';
import Guilds from '@app/features/guild/state/Guilds';
import Permission from '@app/features/permissions/state/Permission';
import {Button} from '@app/features/ui/button/Button';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Slider} from '@app/features/ui/components/Slider';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import Users from '@app/features/user/state/Users';
import styles from '@app/features/voice/components/Soundboard.module.css';
import {openSoundboardSoundModal} from '@app/features/voice/components/SoundboardSoundModal';
import MediaEngine, {useMediaEngineVersion} from '@app/features/voice/engine/MediaEngineFacade';
import {SoundboardPlaybackEngine} from '@app/features/voice/engine/SoundboardPlaybackEngine';
import {getEffectiveAudioState} from '@app/features/voice/engine/VoiceEffectiveAudioState';
import SoundboardLibrary, {type SoundboardSound} from '@app/features/voice/state/SoundboardLibrary';
import SoundboardPreferences from '@app/features/voice/state/SoundboardPreferences';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {SOUNDBOARD_MAX_SOUNDS} from '@fluxer/constants/src/SoundboardConstants';
import {Trans, useLingui} from '@lingui/react/macro';
import {
	MagnifyingGlassIcon,
	MusicNotesIcon,
	PlayIcon,
	PlusIcon,
	SpeakerHighIcon,
	StarIcon,
	XIcon,
} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

export const SoundboardPicker = observer(({onClose}: {onClose: () => void}) => {
	const {t, i18n} = useLingui();
	useMediaEngineVersion();
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState('all');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const guildId = MediaEngine.guildId;
	const channelId = MediaEngine.channelId;
	const guilds = Guilds.getGuilds().sort((a, b) => Number(b.id === guildId) - Number(a.id === guildId));
	const guildIds = guilds.map((guild) => guild.id).join(',');
	useEffect(() => {
		let active = true;
		let failed = false;
		setLoading(true);
		setError(null);
		const remaining = guildIds.split(',').filter(Boolean);
		const loadGuilds = async () => {
			while (active) {
				const id = remaining.shift();
				if (!id) return;
				try {
					await SoundboardLibrary.loadGuild(id);
				} catch {
					failed = true;
				}
			}
		};
		void Promise.allSettled([
			SoundboardLibrary.loadDefaults(),
			...Array.from({length: Math.min(4, remaining.length)}, loadGuilds),
		]).then((results) => {
			if (!active) return;
			setLoading(false);
			if (failed || results.some((result) => result.status === 'rejected'))
				setError(t`Some sounds could not load. Reopen the soundboard to try again.`);
		});
		return () => {
			active = false;
			SoundboardPlaybackEngine.stopPreview();
		};
	}, [guildIds, i18n.locale]);
	const audioState = getEffectiveAudioState();
	const canUse =
		MediaEngine.connected &&
		!!channelId &&
		!audioState.effectiveDeaf &&
		!audioState.serverMute &&
		(!guildId || Permission.can(Permissions.SPEAK | Permissions.USE_SOUNDBOARD, {channelId}));
	const canExternal =
		Users.getCurrentUser()?.isPremium() &&
		(!guildId || (!!channelId && Permission.can(Permissions.USE_EXTERNAL_SOUNDS, {channelId})));
	const preview = (sound: SoundboardSound) => {
		void SoundboardPlaybackEngine.preview(sound).catch(() => setError(t`Could not preview this sound.`));
	};
	const play = async (sound: SoundboardSound) => {
		if (!channelId || sending) return;
		setSending(true);
		setError(null);
		try {
			await SoundboardLibrary.play(channelId, sound);
		} catch {
			setError(t`Could not play sound. Check your voice permissions or wait a moment before trying again.`);
		} finally {
			setSending(false);
		}
	};
	const matches = (sound: SoundboardSound) =>
		sound.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
		(selected !== 'favorites' || SoundboardPreferences.isFavorite(sound.sound_id));
	const groups = [
		{id: 'default', name: t`Fluxer sounds`, sounds: SoundboardLibrary.defaults},
		...guilds.map((guild) => ({id: guild.id, name: guild.name, sounds: SoundboardLibrary.guildSounds[guild.id] ?? []})),
	]
		.filter((group) => selected === 'all' || selected === 'favorites' || selected === group.id)
		.map((group) => ({...group, sounds: group.sounds.filter(matches)}));
	const canCreate = !!guildId && Permission.can(Permissions.CREATE_EXPRESSIONS, {guildId});
	const uploadLimitReached =
		!!guildId &&
		(SoundboardLibrary.guildSounds[guildId]?.length ?? 0) >=
			(Guilds.getGuild(guildId)?.maxSoundboardSounds ?? SOUNDBOARD_MAX_SOUNDS);
	return (
		<section className={styles.picker} role="dialog" aria-label={t`Soundboard`} data-flx="voice.soundboard-picker.root">
			<header className={styles.header} data-flx="voice.soundboard-picker.header">
				<MusicNotesIcon size={22} data-flx="voice.soundboard-picker.heading-icon" />
				<h2 data-flx="voice.soundboard-picker.heading">
					<Trans>Soundboard</Trans>
				</h2>
				<button
					type="button"
					className={styles.iconButton}
					onClick={onClose}
					aria-label={t`Close soundboard`}
					data-flx="voice.soundboard-picker.close"
				>
					<XIcon size={20} data-flx="voice.soundboard-picker.close-icon" />
				</button>
			</header>
			<div className={styles.search} data-flx="voice.soundboard-picker.search">
				<Input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t`Search sounds`}
					aria-label={t`Search sounds`}
					leftIcon={<MagnifyingGlassIcon data-flx="voice.soundboard-picker.search-icon" />}
					autoFocus
					data-flx="voice.soundboard-picker.search-input"
				/>
			</div>
			<div className={styles.browser} data-flx="voice.soundboard-picker.browser">
				<nav className={styles.rail} aria-label={t`Sound libraries`} data-flx="voice.soundboard-picker.libraries">
					{[
						{
							id: 'all',
							name: t`All sounds`,
							icon: <MusicNotesIcon size={23} data-flx="voice.soundboard-picker.all-icon" />,
						},
						{
							id: 'favorites',
							name: t`Favorites`,
							icon: <StarIcon size={23} weight="fill" data-flx="voice.soundboard-picker.favorites-icon" />,
						},
						{
							id: 'default',
							name: t`Fluxer sounds`,
							icon: <MusicNotesIcon size={23} weight="fill" data-flx="voice.soundboard-picker.defaults-icon" />,
						},
						...guilds.map((guild) => ({
							id: guild.id,
							name: guild.name,
							icon: (
								<GuildIcon
									id={guild.id}
									name={guild.name}
									icon={guild.icon}
									sizePx={40}
									data-flx="voice.soundboard-picker.guild-icon"
								/>
							),
						})),
					].map((item) => (
						<Tooltip key={item.id} text={item.name} position="right" data-flx="voice.soundboard-picker.library-tooltip">
							<button
								type="button"
								className={clsx(styles.libraryButton, selected === item.id && styles.selected)}
								aria-label={item.name}
								aria-pressed={selected === item.id}
								onClick={() => setSelected(item.id)}
								data-flx="voice.soundboard-picker.library"
							>
								{item.icon}
							</button>
						</Tooltip>
					))}
				</nav>
				<div className={styles.sounds} aria-busy={loading} data-flx="voice.soundboard-picker.sounds">
					{groups.map(
						(group) =>
							group.sounds.length > 0 && (
								<section key={group.id} data-flx="voice.soundboard-picker.group">
									<h3 className={styles.groupTitle} data-flx="voice.soundboard-picker.group-title">
										{group.name}
									</h3>
									<div className={styles.grid} data-flx="voice.soundboard-picker.grid">
										{group.sounds.map((sound) => {
											const external = !!sound.guild_id && sound.guild_id !== guildId;
											const disabled = !canUse || !sound.available || (external && !canExternal);
											const emoji = sound.emoji_id
												? Emoji.getGuildEmoji(sound.guild_id ?? '').find((item) => item.id === sound.emoji_id)
												: null;
											return (
												<div className={styles.tile} key={sound.sound_id} data-flx="voice.soundboard-picker.tile">
													<button
														type="button"
														className={styles.soundButton}
														disabled={disabled || sending}
														onClick={(event) => (event.shiftKey ? preview(sound) : void play(sound))}
														aria-label={t`Play ${sound.name}`}
														data-flx="voice.soundboard-picker.play"
													>
														<span
															className={styles.soundEmoji}
															aria-hidden="true"
															data-flx="voice.soundboard-picker.emoji"
														>
															{emoji ? (
																<img src={emoji.url} alt="" data-flx="voice.soundboard-picker.custom-emoji" />
															) : (
																sound.emoji_name || <MusicNotesIcon data-flx="voice.soundboard-picker.fallback-icon" />
															)}
														</span>
														<span className={styles.soundName} data-flx="voice.soundboard-picker.name">
															{sound.name}
														</span>
													</button>
													<div className={styles.tileActions} data-flx="voice.soundboard-picker.tile-actions">
														<button
															type="button"
															className={styles.iconButton}
															aria-label={t`Preview ${sound.name}`}
															onClick={() => preview(sound)}
															data-flx="voice.soundboard-picker.preview"
														>
															<PlayIcon size={13} weight="fill" data-flx="voice.soundboard-picker.preview-icon" />
														</button>
														<button
															type="button"
															className={clsx(
																styles.iconButton,
																SoundboardPreferences.isFavorite(sound.sound_id) && styles.favorite,
															)}
															aria-label={
																SoundboardPreferences.isFavorite(sound.sound_id)
																	? t`Remove ${sound.name} from favorites`
																	: t`Favorite ${sound.name}`
															}
															aria-pressed={SoundboardPreferences.isFavorite(sound.sound_id)}
															onClick={() => SoundboardPreferences.toggleFavorite(sound.sound_id)}
															data-flx="voice.soundboard-picker.favorite"
														>
															<StarIcon
																size={13}
																weight={SoundboardPreferences.isFavorite(sound.sound_id) ? 'fill' : 'regular'}
																data-flx="voice.soundboard-picker.star"
															/>
														</button>
													</div>
												</div>
											);
										})}
									</div>
								</section>
							),
					)}
					{!loading && groups.every((group) => !group.sounds.length) && (
						<p className={styles.empty} data-flx="voice.soundboard-picker.empty">
							<Trans>No sounds found.</Trans>
						</p>
					)}
					{loading && (
						<p className={styles.empty} role="status" data-flx="voice.soundboard-picker.loading">
							<Trans>Loading sounds…</Trans>
						</p>
					)}
				</div>
			</div>
			{!canUse && (
				<p className={styles.notice} data-flx="voice.soundboard-picker.unavailable">
					<Trans>Join voice and enable soundboard permissions to play sounds.</Trans>
				</p>
			)}
			{error && (
				<p className={styles.error} role="alert" data-flx="voice.soundboard-picker.error">
					{error}
				</p>
			)}
			<footer className={styles.footer} data-flx="voice.soundboard-picker.footer">
				<SpeakerHighIcon size={20} data-flx="voice.soundboard-picker.volume-icon" />
				<Slider
					defaultValue={100}
					factoryDefaultValue={100}
					value={SoundboardPreferences.volume}
					onValueChange={SoundboardPreferences.setVolume}
					minValue={0}
					maxValue={100}
					ariaLabel={t`Soundboard volume`}
					mini
					data-flx="voice.soundboard-picker.volume"
				/>
				<span className={styles.volumeValue} data-flx="voice.soundboard-picker.volume-value">
					{Math.round(SoundboardPreferences.volume)}%
				</span>
				{canCreate && (
					<Button
						small
						disabled={loading || uploadLimitReached}
						variant="secondary"
						leftIcon={<PlusIcon data-flx="voice.soundboard-picker.add-icon" />}
						onClick={() => {
							onClose();
							openSoundboardSoundModal(guildId!);
						}}
						data-flx="voice.soundboard-picker.add"
					>
						<Trans>Add sound</Trans>
					</Button>
				)}
			</footer>
		</section>
	);
});
