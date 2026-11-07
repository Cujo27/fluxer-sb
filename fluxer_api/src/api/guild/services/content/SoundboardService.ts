// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	type ChannelID,
	createGuildID,
	createSoundboardSoundID,
	createUserID,
	type GuildID,
	type SoundboardSoundID,
	type UserID,
} from '@app/api/BrandedTypes';
import {Config} from '@app/api/Config';
import type {ChannelRepository} from '@app/api/channel/ChannelRepository';
import type {GuildAuditLogService} from '@app/api/guild/GuildAuditLogService';
import {withGuildUpdateLock} from '@app/api/guild/GuildUpdateLock';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import type {
	GuildSoundboardRepository,
	GuildSoundboardRow,
} from '@app/api/guild/repositories/GuildSoundboardRepository';
import {resolveGuildLimit} from '@app/api/guild/services/content/ExpressionHelpers';
import type {IAssetDeletionQueue} from '@app/api/infrastructure/IAssetDeletionQueue';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {IMediaService} from '@app/api/infrastructure/IMediaService';
import type {ISnowflakeService} from '@app/api/infrastructure/ISnowflakeService';
import type {IStorageService} from '@app/api/infrastructure/IStorageService';
import {Logger} from '@app/api/Logger';
import type {LimitConfigService} from '@app/api/limits/LimitConfigService';
import type {User} from '@app/api/models/User';
import {assertAccountNotLimited} from '@app/api/user/AccountLimit';
import type {UserRepository} from '@app/api/user/repositories/UserRepository';
import {mapUserToPartialResponse} from '@app/api/user/UserMappers';
import {requirePermission} from '@app/api/utils/PermissionUtils';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {AuditLogActionType} from '@fluxer/constants/src/AuditLogActionType';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {
	DEFAULT_SOUNDBOARD_SOUNDS,
	detectSoundboardAudioContentType,
	normalizeSoundboardAudioContentType,
	SOUNDBOARD_DURATION_MAX_MS,
	SOUNDBOARD_MAX_BYTES,
	SOUNDBOARD_MAX_DURATION_MS,
	SOUNDBOARD_MAX_SOUNDS,
	SOUNDBOARD_UPLOAD_MAX_BYTES,
} from '@fluxer/constants/src/SoundboardConstants';
import {UnknownChannelError} from '@fluxer/errors/src/domains/channel/UnknownChannelError';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import {MissingAccessError} from '@fluxer/errors/src/domains/core/MissingAccessError';
import {MissingPermissionsError} from '@fluxer/errors/src/domains/core/MissingPermissionsError';
import {NotFoundError} from '@fluxer/errors/src/domains/core/NotFoundError';
import type {
	GuildSoundboardCreateRequest,
	GuildSoundboardUpdateRequest,
	SendSoundboardSoundRequest,
	SoundboardSoundResponse,
} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import type {ICacheService} from '@pkgs/cache/src/ICacheService';

export class SoundboardService {
	constructor(
		private readonly repository: GuildSoundboardRepository,
		private readonly guilds: GuildRepository,
		private readonly users: UserRepository,
		private readonly channels: ChannelRepository,
		private readonly gateway: IGatewayService,
		private readonly storage: IStorageService,
		private readonly media: IMediaService,
		private readonly snowflake: ISnowflakeService,
		private readonly locks: ICacheService,
		private readonly audit: GuildAuditLogService,
		private readonly deletions: IAssetDeletionQueue,
		private readonly limits: LimitConfigService,
	) {}

	private url(soundId: string): string {
		return `${Config.endpoints.media}/soundboard-sounds/${soundId}`;
	}

	defaults(): Array<SoundboardSoundResponse> {
		return DEFAULT_SOUNDBOARD_SOUNDS.map((sound) => ({
			...sound,
			volume: 1,
			emoji_id: null,
			available: true,
			url: `${Config.endpoints.staticCdn.replace(/\/+$/, '')}/soundboard/${sound.sound_id}.wav`,
			duration_ms: 2000,
		}));
	}

	serialize(row: GuildSoundboardRow, creator?: User): SoundboardSoundResponse {
		return {
			sound_id: row.sound_id.toString(),
			guild_id: row.guild_id.toString(),
			name: row.name,
			volume: row.volume,
			emoji_id: row.emoji_id?.toString() ?? null,
			emoji_name: row.emoji_name,
			user_id: row.creator_id.toString(),
			...(creator ? {user: mapUserToPartialResponse(creator)} : {}),
			available: true,
			duration_ms: row.duration_ms,
			url: this.url(row.sound_id.toString()),
		};
	}

	async list(userId: UserID, guildId: GuildID): Promise<Array<SoundboardSoundResponse>> {
		await this.gateway.getGuildData({userId, guildId});
		const rows = await this.repository.list(guildId);
		const creators = new Map(
			(await this.users.listUsers([...new Set(rows.map((row) => row.creator_id))])).map((user) => [user.id, user]),
		);
		return rows.map((row) => this.serialize(row, creators.get(row.creator_id)));
	}

	async get(userId: UserID, guildId: GuildID, soundId: SoundboardSoundID): Promise<SoundboardSoundResponse> {
		await this.gateway.getGuildData({userId, guildId});
		const row = await this.find(guildId, soundId);
		return this.serialize(row, (await this.users.findUnique(row.creator_id)) ?? undefined);
	}

	private async find(guildId: GuildID, soundId: SoundboardSoundID): Promise<GuildSoundboardRow> {
		const sound = await this.repository.get(guildId, soundId);
		if (!sound) throw new NotFoundError({code: APIErrorCodes.NOT_FOUND, message: 'Unknown soundboard sound'});
		return sound;
	}

	private async checkModify(userId: UserID, row: GuildSoundboardRow): Promise<void> {
		await this.gateway.getGuildData({userId, guildId: row.guild_id});
		if (await this.gateway.checkPermission({userId, guildId: row.guild_id, permission: Permissions.MANAGE_EXPRESSIONS}))
			return;
		if (row.creator_id !== userId) throw new MissingPermissionsError();
		await requirePermission(this.gateway, {userId, guildId: row.guild_id, permission: Permissions.CREATE_EXPRESSIONS});
	}

	private async checkEmoji(guildId: GuildID, emojiId: bigint | null | undefined): Promise<void> {
		if (emojiId && !(await this.guilds.listEmojis(guildId)).some((emoji) => emoji.id === emojiId)) {
			throw InputValidationError.create('emoji_id', 'Choose an emoji from this server');
		}
	}

	async create(
		user: User,
		guildId: GuildID,
		data: GuildSoundboardCreateRequest,
		reason: string | null,
	): Promise<SoundboardSoundResponse> {
		assertAccountNotLimited(user);
		const guild = await this.gateway.getGuildData({userId: user.id, guildId});
		await requirePermission(this.gateway, {userId: user.id, guildId, permission: Permissions.CREATE_EXPRESSIONS});
		const maxSounds = resolveGuildLimit(
			this.limits,
			'max_guild_soundboard_sounds',
			SOUNDBOARD_MAX_SOUNDS,
			guild.features,
		);
		const maxBytes = Math.min(
			SOUNDBOARD_UPLOAD_MAX_BYTES,
			resolveGuildLimit(this.limits, 'soundboard_max_size', SOUNDBOARD_MAX_BYTES, guild.features),
		);
		const maxDurationMs = Math.min(
			SOUNDBOARD_DURATION_MAX_MS,
			resolveGuildLimit(this.limits, 'soundboard_max_duration_ms', SOUNDBOARD_MAX_DURATION_MS, guild.features),
		);
		await this.checkEmoji(guildId, data.emoji_id);
		const match = /^data:(audio\/[a-z0-9-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data.sound);
		const declaredType = match ? normalizeSoundboardAudioContentType(match[1]!) : null;
		if (!match || !declaredType) throw InputValidationError.create('sound', 'Choose an MP3, OGG, or WAV audio file');
		const base64 = match[2]!;
		if (base64.length > 4 * Math.ceil(maxBytes / 3)) {
			throw InputValidationError.create('sound', `Audio must be at most ${maxBytes} bytes`);
		}
		const bytes = Buffer.from(base64, 'base64');
		if (!bytes.length || bytes.toString('base64') !== base64 || bytes.length > maxBytes) {
			throw InputValidationError.create('sound', `Audio must be valid base64 and at most ${maxBytes} bytes`);
		}
		const detectedType = detectSoundboardAudioContentType(bytes);
		if (detectedType !== declaredType)
			throw InputValidationError.create('sound', 'The audio content must match its MP3, OGG, or WAV file type');
		const metadata = await this.media.getMetadata({type: 'base64', base64, version: 2, nsfw: 'allow'});
		if (!metadata || normalizeSoundboardAudioContentType(metadata.content_type) !== detectedType) {
			throw InputValidationError.create('sound', 'Choose an MP3, OGG, or WAV audio file');
		}
		const duration = await this.media.getAudioDurationSeconds(base64);
		if (duration === null || !Number.isFinite(duration) || duration <= 0 || duration * 1000 > maxDurationMs) {
			throw InputValidationError.create('sound', `Audio must be no longer than ${maxDurationMs / 1000} seconds`);
		}
		return withGuildUpdateLock(this.locks, guildId, async () => {
			if ((await this.repository.list(guildId)).length >= maxSounds) {
				throw InputValidationError.create('sound', `This server has reached its limit of ${maxSounds} sounds`);
			}
			const row: GuildSoundboardRow = {
				guild_id: guildId,
				sound_id: createSoundboardSoundID(await this.snowflake.generate()),
				creator_id: user.id,
				name: data.name,
				volume: data.volume ?? 1,
				emoji_id: data.emoji_id ?? null,
				emoji_name: data.emoji_name ?? null,
				content_type: detectedType,
				duration_ms: Math.round(duration * 1000),
			};
			const key = `soundboard-sounds/${row.sound_id}`;
			await this.storage.uploadObject({bucket: Config.s3.buckets.cdn, key, body: bytes, contentType: row.content_type});
			try {
				await this.repository.save(row);
			} catch (error) {
				// A timed-out write may have committed. Never remove a possibly referenced object.
				if (!(await this.repository.get(guildId, row.sound_id).catch(() => true))) {
					await this.deletions.queueDeletion({
						s3Key: key,
						cdnUrl: this.url(row.sound_id.toString()),
						reason: 'soundboard_create_rollback',
					});
				}
				throw error;
			}
			const sound = this.serialize(row, user);
			await this.audit.record({
				guildId,
				userId: user.id,
				targetId: row.sound_id,
				action: AuditLogActionType.SOUNDBOARD_SOUND_CREATE,
				auditLogReason: reason,
				changes: this.audit.computeChanges(null, sound),
			});
			await this.gateway.dispatchGuild({guildId, event: 'GUILD_SOUNDBOARD_SOUND_CREATE', data: sound});
			return sound;
		});
	}

	async update(
		userId: UserID,
		guildId: GuildID,
		soundId: SoundboardSoundID,
		data: GuildSoundboardUpdateRequest,
		reason: string | null,
	): Promise<SoundboardSoundResponse> {
		return withGuildUpdateLock(this.locks, guildId, async () => {
			const previous = await this.find(guildId, soundId);
			await this.checkModify(userId, previous);
			await this.checkEmoji(guildId, data.emoji_id);
			const next = {
				...previous,
				name: data.name ?? previous.name,
				volume: data.volume === undefined ? previous.volume : (data.volume ?? 1),
			};
			if (data.emoji_id !== undefined) {
				next.emoji_id = data.emoji_id;
				if (data.emoji_id) next.emoji_name = null;
			}
			if (data.emoji_name !== undefined) {
				next.emoji_name = data.emoji_name;
				if (data.emoji_name) next.emoji_id = null;
			}
			await this.repository.save(next);
			const creator = (await this.users.findUnique(next.creator_id)) ?? undefined;
			const sound = this.serialize(next, creator);
			await this.audit.record({
				guildId,
				userId,
				targetId: soundId,
				action: AuditLogActionType.SOUNDBOARD_SOUND_UPDATE,
				auditLogReason: reason,
				changes: this.audit.computeChanges(this.serialize(previous, creator), sound),
				metadata: {sound_name: next.name},
			});
			await this.gateway.dispatchGuild({guildId, event: 'GUILD_SOUNDBOARD_SOUND_UPDATE', data: sound});
			return sound;
		});
	}

	async delete(userId: UserID, guildId: GuildID, soundId: SoundboardSoundID, reason: string | null): Promise<void> {
		await withGuildUpdateLock(this.locks, guildId, async () => {
			const row = await this.find(guildId, soundId);
			await this.checkModify(userId, row);
			await this.repository.delete(guildId, soundId);
			await this.deletions.queueDeletion({
				s3Key: `soundboard-sounds/${soundId}`,
				cdnUrl: this.url(soundId.toString()),
				reason: 'soundboard_delete',
			});
			await this.audit.record({
				guildId,
				userId,
				targetId: soundId,
				action: AuditLogActionType.SOUNDBOARD_SOUND_DELETE,
				auditLogReason: reason,
				changes: this.audit.computeChanges(this.serialize(row), null),
			});
			await this.gateway.dispatchGuild({
				guildId,
				event: 'GUILD_SOUNDBOARD_SOUND_DELETE',
				data: {guild_id: guildId.toString(), sound_id: soundId.toString()},
			});
		});
	}

	async play(user: User, channelId: ChannelID, data: SendSoundboardSoundRequest): Promise<void> {
		assertAccountNotLimited(user);
		const channel = await this.channels.channelData.findUnique(channelId);
		if (
			!channel ||
			(channel.type !== ChannelTypes.GUILD_VOICE &&
				channel.type !== ChannelTypes.DM &&
				channel.type !== ChannelTypes.GROUP_DM)
		)
			throw new UnknownChannelError();
		const guildId = channel.guildId ?? undefined;
		const {voiceStates} = await this.gateway.getVoiceStatesForChannel({guildId, channelId});
		const senderStates = voiceStates.filter((state) => state.userId === user.id.toString());
		if (
			!senderStates.length ||
			senderStates.every(
				(state) => state.mute !== false || state.deaf !== false || state.selfDeaf !== false || state.suppress !== false,
			)
		)
			throw new MissingAccessError();
		if (guildId) {
			await requirePermission(this.gateway, {
				userId: user.id,
				guildId,
				channelId,
				permission: Permissions.SPEAK | Permissions.USE_SOUNDBOARD,
			});
		}
		const defaultSound = this.defaults().find((sound) => sound.sound_id === data.sound_id.toString());
		let sound: SoundboardSoundResponse;
		if (defaultSound) {
			sound = defaultSound;
		} else {
			const sourceGuildId = data.source_guild_id ? createGuildID(data.source_guild_id) : guildId;
			if (!sourceGuildId) throw InputValidationError.create('source_guild_id', 'A source server is required');
			await this.gateway.getGuildData({userId: user.id, guildId: sourceGuildId});
			if (sourceGuildId !== guildId) {
				if (!user.isBot && !user.isPremium()) throw new MissingAccessError();
				if (guildId)
					await requirePermission(this.gateway, {
						userId: user.id,
						guildId,
						channelId,
						permission: Permissions.USE_EXTERNAL_SOUNDS,
					});
			}
			sound = this.serialize(await this.find(sourceGuildId, createSoundboardSoundID(data.sound_id)));
		}
		const event = {
			guild_id: guildId?.toString() ?? null,
			channel_id: channelId.toString(),
			user_id: user.id.toString(),
			sound_id: sound.sound_id,
			sound_volume: sound.volume,
			emoji_id: sound.emoji_id,
			emoji_name: sound.emoji_name,
			source_guild_id: sound.guild_id ?? null,
			url: sound.url,
			duration_ms: sound.duration_ms ?? 2000,
		};
		const recipients = [...new Set(voiceStates.map((state) => state.userId))];
		await Promise.all(
			recipients.map(async (recipient) => {
				try {
					await this.gateway.dispatchPresence({
						userId: createUserID(BigInt(recipient)),
						event: 'VOICE_CHANNEL_EFFECT_SEND',
						data: event,
					});
				} catch (error) {
					Logger.warn({error, recipient, channelId: channelId.toString()}, 'Failed to dispatch soundboard effect');
				}
			}),
		);
	}

	async purgeGuild(guildId: GuildID): Promise<void> {
		await withGuildUpdateLock(this.locks, guildId, async () => {
			for (const row of await this.repository.list(guildId)) {
				await this.deletions.queueDeletion({
					s3Key: `soundboard-sounds/${row.sound_id}`,
					cdnUrl: this.url(row.sound_id.toString()),
					reason: 'guild_delete',
				});
				await this.repository.delete(guildId, row.sound_id);
			}
		});
	}
}
