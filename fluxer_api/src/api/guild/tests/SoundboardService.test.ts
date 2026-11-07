// SPDX-License-Identifier: AGPL-3.0-or-later

import {readFileSync} from 'node:fs';
import {createChannelID, createGuildID, createSoundboardSoundID, createUserID} from '@app/api/BrandedTypes';
import type {ChannelRepository} from '@app/api/channel/ChannelRepository';
import {createDefaultLimitConfig} from '@app/api/constants/LimitConfig';
import {EMPTY_USER_ROW} from '@app/api/database/types/UserTypes';
import type {GuildAuditLogService} from '@app/api/guild/GuildAuditLogService';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import {GuildSoundboardRepository} from '@app/api/guild/repositories/GuildSoundboardRepository';
import {SoundboardService} from '@app/api/guild/services/content/SoundboardService';
import type {IAssetDeletionQueue} from '@app/api/infrastructure/IAssetDeletionQueue';
import type {GatewayVoiceStateEntry, IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {IMediaService} from '@app/api/infrastructure/IMediaService';
import type {ISnowflakeService} from '@app/api/infrastructure/ISnowflakeService';
import type {IStorageService} from '@app/api/infrastructure/IStorageService';
import {InstanceConfigRepository} from '@app/api/instance/InstanceConfigRepository';
import {LimitConfigService, resetGlobalLimitConfigServiceForTesting} from '@app/api/limits/LimitConfigService';
import {User} from '@app/api/models/User';
import type {UserRepository} from '@app/api/user/repositories/UserRepository';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {LimitKey} from '@fluxer/constants/src/LimitConfigMetadata';
import {SOUNDBOARD_MAX_BYTES, SOUNDBOARD_MAX_SOUNDS} from '@fluxer/constants/src/SoundboardConstants';
import {
	GuildSoundboardCreateRequest,
	GuildSoundboardUpdateRequest,
} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {KVCacheProvider} from '@pkgs/cache/src/providers/KVCacheProvider';
import {MockKVProvider} from '@pkgs/kv_client/src/testing/MockKVProvider';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const guildId = createGuildID(100n);
const channelId = createChannelID(200n);
const otherGuildId = createGuildID(300n);
const userId = createUserID(400n);
const soundId = createSoundboardSoundID(500n);
const mp3Bytes = Buffer.concat([
	Buffer.from([0xff, 0xfb, 0x90, 0x64]),
	Buffer.from('decoded by the mocked media service'),
]);
const validAudio = `data:audio/mpeg;base64,${mp3Bytes.toString('base64')}`;

function setup() {
	const repository = new GuildSoundboardRepository();
	const guilds = {listEmojis: vi.fn().mockResolvedValue([])};
	const channels = {channelData: {findUnique: vi.fn().mockResolvedValue({guildId, type: ChannelTypes.GUILD_VOICE})}};
	const gateway = {
		getGuildData: vi.fn().mockResolvedValue({features: [] as Array<string>}),
		checkPermission: vi.fn().mockResolvedValue(true),
		dispatchGuild: vi.fn().mockResolvedValue(undefined),
		dispatchPresence: vi.fn().mockResolvedValue(undefined),
		getVoiceStatesForChannel: vi.fn().mockResolvedValue({
			voiceStates: [
				{
					userId: userId.toString(),
					channelId: channelId.toString(),
					connectionId: 'sender',
					mute: false,
					deaf: false,
					selfDeaf: false,
					suppress: false,
				},
				{userId: '600', channelId: channelId.toString(), connectionId: 'listener'},
				{userId: '600', channelId: channelId.toString(), connectionId: 'listener2'},
			],
		}),
	};
	const storage = {uploadObject: vi.fn().mockResolvedValue(undefined)};
	const media = {
		getMetadata: vi.fn().mockResolvedValue({content_type: 'audio/mpeg', format: 'mp3'}),
		getAudioDurationSeconds: vi.fn().mockResolvedValue(1),
	};
	let nextId = 500n;
	const snowflake = {generate: vi.fn(async () => nextId++)};
	const audit = {record: vi.fn().mockResolvedValue(undefined), computeChanges: vi.fn().mockReturnValue({})};
	const deletions = {queueDeletion: vi.fn().mockResolvedValue(undefined)};
	const user = new User({...EMPTY_USER_ROW, user_id: userId, username: 'sound_user', discriminator: 0, flags: 0n});
	vi.spyOn(user, 'isPremium').mockReturnValue(false);
	const users = {listUsers: vi.fn().mockResolvedValue([user]), findUnique: vi.fn().mockResolvedValue(user)};
	const limits = {getConfigSnapshot: vi.fn().mockReturnValue(createDefaultLimitConfig())};
	const service = new SoundboardService(
		repository,
		guilds as unknown as GuildRepository,
		users as unknown as UserRepository,
		channels as unknown as ChannelRepository,
		gateway as unknown as IGatewayService,
		storage as unknown as IStorageService,
		media as unknown as IMediaService,
		snowflake as unknown as ISnowflakeService,
		new KVCacheProvider({client: new MockKVProvider()}),
		audit as unknown as GuildAuditLogService,
		deletions as unknown as IAssetDeletionQueue,
		limits as unknown as LimitConfigService,
	);
	return {service, repository, guilds, channels, gateway, storage, media, user, audit, deletions, limits};
}

describe('Soundboard', () => {
	beforeAll(() => {
		new LimitConfigService(
			new InstanceConfigRepository(),
			new KVCacheProvider({client: new MockKVProvider()}),
		).setAsGlobalInstance();
	});
	afterAll(() => resetGlobalLimitConfigServiceForTesting());
	let state: ReturnType<typeof setup>;
	beforeEach(() => {
		state = setup();
	});
	const create = () => state.service.create(state.user, guildId, {name: 'Quack', sound: validAudio}, null);
	const setLimits = (overrides: Partial<Record<LimitKey, number>>) => {
		const config = createDefaultLimitConfig();
		const rule = config.rules.find((rule) => rule.id === 'default')!;
		rule.limits = {...rule.limits, ...overrides};
		state.limits.getConfigSnapshot.mockReturnValue(config);
	};

	it('uses the configured quota above eight sounds and respects later reductions without deleting sounds', async () => {
		setLimits({max_guild_soundboard_sounds: 12});
		for (let i = 0; i < 9; i++) await create();
		expect(await state.repository.list(guildId)).toHaveLength(9);
		setLimits({max_guild_soundboard_sounds: 0});
		await expect(create()).rejects.toThrow();
		await expect(state.service.play(state.user, channelId, {sound_id: soundId})).resolves.toBeUndefined();
		expect(await state.repository.list(guildId)).toHaveLength(9);
	});
	it('enforces configured sizes below and above the old 512 KiB limit', async () => {
		setLimits({soundboard_max_size: mp3Bytes.length - 1});
		await expect(create()).rejects.toThrow();
		expect(state.storage.uploadObject).not.toHaveBeenCalled();
		setLimits({soundboard_max_size: 1024 * 1024});
		const bytes = Buffer.concat([mp3Bytes, Buffer.alloc(600 * 1024)]);
		const data = {name: 'Large', sound: `data:audio/mpeg;base64,${bytes.toString('base64')}`};
		expect(GuildSoundboardCreateRequest.safeParse(data).success).toBe(true);
		await expect(state.service.create(state.user, guildId, data, null)).resolves.toMatchObject({name: 'Large'});
	});
	it('enforces configured clip duration', async () => {
		setLimits({soundboard_max_duration_ms: 1000});
		state.media.getAudioDurationSeconds.mockResolvedValue(1.01);
		await expect(create()).rejects.toThrow();
		setLimits({soundboard_max_duration_ms: 8000});
		state.media.getAudioDurationSeconds.mockResolvedValue(7.5);
		await expect(create()).resolves.toMatchObject({duration_ms: 7500});
	});
	it('resolves server feature rules without applying user-only trait rules to a server quota', async () => {
		setLimits({max_guild_soundboard_sounds: 0});
		const config = state.limits.getConfigSnapshot();
		config.rules.push({
			id: 'feature',
			filters: {guildFeatures: ['MORE_SOUNDS']},
			limits: {max_guild_soundboard_sounds: 1},
		});
		config.rules.push({id: 'premium', filters: {traits: ['premium']}, limits: {max_guild_soundboard_sounds: 99}});
		state.gateway.getGuildData.mockResolvedValue({features: ['MORE_SOUNDS']});
		await expect(create()).resolves.toBeDefined();
		await expect(create()).rejects.toThrow();
	});
	it.each([
		['audio/mp4', Buffer.from('....ftypM4A ....')],
		['audio/mpeg', Buffer.from('....ftypM4A ....')],
		['audio/ogg', mp3Bytes],
		['audio/wav', Buffer.from('not a WAV file')],
	])('rejects unsupported or falsely labeled %s content before media processing', async (mime, bytes) => {
		await expect(
			state.service.create(
				state.user,
				guildId,
				{name: 'Invalid', sound: `data:${mime};base64,${bytes.toString('base64')}`},
				null,
			),
		).rejects.toThrow();
		expect(state.media.getMetadata).not.toHaveBeenCalled();
		expect(state.storage.uploadObject).not.toHaveBeenCalled();
	});
	it('accepts WAV from the shared trimmer and OGG with an Opus audio header', async () => {
		const wav = readFileSync(new URL('../../../../../fluxer_static/soundboard/1.wav', import.meta.url));
		const ogg = Buffer.alloc(47);
		ogg.write('OggS');
		ogg[26] = 1;
		ogg[27] = 19;
		ogg.write('OpusHead', 28);
		for (const [bytes, mime, format] of [
			[wav, 'audio/wav', 'wav'],
			[ogg, 'audio/ogg', 'ogg'],
		] as const) {
			state.media.getMetadata.mockResolvedValue({content_type: mime, format});
			await expect(
				state.service.create(
					state.user,
					guildId,
					{name: 'Supported', sound: `data:${mime};base64,${bytes.toString('base64')}`},
					null,
				),
			).resolves.toMatchObject({name: 'Supported'});
		}
		expect(state.storage.uploadObject).toHaveBeenCalledTimes(2);
	});

	it('persists a sound, updates metadata without changing audio, and deletes it with queued asset cleanup', async () => {
		const sound = await create();
		expect(sound).toMatchObject({sound_id: '500', guild_id: '100', volume: 1, emoji_id: null, available: true});
		expect(sound.user).toMatchObject({id: userId.toString(), username: 'sound_user'});
		expect(await state.service.list(userId, guildId)).toHaveLength(1);
		await state.service.update(userId, guildId, soundId, {name: 'Renamed', volume: 0.25, emoji_name: '🦆'}, 'test');
		expect(await state.service.get(userId, guildId, soundId)).toMatchObject({
			name: 'Renamed',
			volume: 0.25,
			emoji_name: '🦆',
		});
		expect(state.storage.uploadObject).toHaveBeenCalledTimes(1);
		await state.service.delete(userId, guildId, soundId, null);
		expect(await state.repository.list(guildId)).toEqual([]);
		expect(state.deletions.queueDeletion).toHaveBeenCalledWith(
			expect.objectContaining({s3Key: 'soundboard-sounds/500'}),
		);
		expect(state.audit.record).toHaveBeenCalledTimes(3);
		expect(state.gateway.dispatchGuild.mock.calls.map(([call]) => call.event)).toEqual([
			'GUILD_SOUNDBOARD_SOUND_CREATE',
			'GUILD_SOUNDBOARD_SOUND_UPDATE',
			'GUILD_SOUNDBOARD_SOUND_DELETE',
		]);
	});
	it('requires Create Expressions before processing an upload', async () => {
		state.gateway.checkPermission.mockResolvedValue(false);
		await expect(create()).rejects.toThrow();
		expect(state.media.getMetadata).not.toHaveBeenCalled();
		expect(state.storage.uploadObject).not.toHaveBeenCalled();
	});
	it('does not let creators with revoked permissions edit their sounds', async () => {
		await create();
		state.gateway.checkPermission.mockResolvedValue(false);
		await expect(state.service.update(userId, guildId, soundId, {name: 'Denied'}, null)).rejects.toThrow();
		expect((await state.repository.get(guildId, soundId))?.name).toBe('Quack');
	});
	it('requires Manage Expressions to modify another member’s sound', async () => {
		await create();
		state.gateway.checkPermission.mockResolvedValue(false);
		await expect(state.service.delete(createUserID(999n), guildId, soundId, null)).rejects.toThrow();
		expect(await state.repository.get(guildId, soundId)).not.toBeNull();
	});
	it('allows a manager to edit their own sound without Create Expressions', async () => {
		await create();
		state.gateway.checkPermission.mockImplementation(
			async ({permission}) => permission === Permissions.MANAGE_EXPRESSIONS,
		);
		await expect(state.service.update(userId, guildId, soundId, {volume: 0}, null)).resolves.toMatchObject({volume: 0});
	});
	it.each([null, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 5.201])(
		'rejects invalid or excessive measured duration %s',
		async (duration) => {
			state.media.getAudioDurationSeconds.mockResolvedValue(duration);
			await expect(create()).rejects.toThrow();
			expect(state.storage.uploadObject).not.toHaveBeenCalled();
		},
	);
	it('accepts the 5.2 second boundary', async () => {
		state.media.getAudioDurationSeconds.mockResolvedValue(5.2);
		await expect(create()).resolves.toMatchObject({duration_ms: 5200});
	});
	it('rejects oversized, malformed and disguised audio', async () => {
		for (const sound of [
			'data:audio/mpeg;base64,@@@',
			`data:audio/mpeg;base64,${Buffer.alloc(SOUNDBOARD_MAX_BYTES + 1).toString('base64')}`,
		]) {
			await expect(state.service.create(state.user, guildId, {name: 'Test', sound}, null)).rejects.toThrow();
		}
		state.media.getMetadata.mockResolvedValue({content_type: 'video/mp4', format: 'mp4'});
		await expect(create()).rejects.toThrow();
		expect(state.storage.uploadObject).not.toHaveBeenCalled();
	});
	it('serializes concurrent uploads so the server quota cannot be exceeded', async () => {
		const results = await Promise.allSettled(Array.from({length: SOUNDBOARD_MAX_SOUNDS + 1}, create));
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(SOUNDBOARD_MAX_SOUNDS);
		expect(await state.repository.list(guildId)).toHaveLength(SOUNDBOARD_MAX_SOUNDS);
	});
	it('rejects custom emoji from another guild', async () => {
		await expect(
			state.service.create(state.user, guildId, {name: 'Test', sound: validAudio, emoji_id: 999n}, null),
		).rejects.toThrow();
		expect(state.storage.uploadObject).not.toHaveBeenCalled();
	});
	it('delivers playback to each connected user once, including the sender', async () => {
		await create();
		await state.service.play(state.user, channelId, {sound_id: soundId});
		expect(state.gateway.dispatchPresence).toHaveBeenCalledTimes(2);
		expect(state.gateway.dispatchPresence).toHaveBeenCalledWith(
			expect.objectContaining({
				userId,
				event: 'VOICE_CHANNEL_EFFECT_SEND',
				data: expect.objectContaining({sound_id: '500', sound_volume: 1, channel_id: '200'}),
			}),
		);
	});
	it.each(['mute', 'deaf', 'selfDeaf', 'suppress'] as const)('rejects playback while %s is enabled', async (flag) => {
		state.gateway.getVoiceStatesForChannel.mockResolvedValue({
			voiceStates: [
				{
					userId: userId.toString(),
					channelId: '200',
					connectionId: 'sender',
					mute: false,
					deaf: false,
					selfDeaf: false,
					suppress: false,
					[flag]: true,
				} as GatewayVoiceStateEntry,
			],
		});
		await expect(state.service.play(state.user, channelId, {sound_id: 1n})).rejects.toThrow();
		expect(state.gateway.dispatchPresence).not.toHaveBeenCalled();
	});
	it('rejects playback outside voice and without soundboard channel permission', async () => {
		state.gateway.getVoiceStatesForChannel.mockResolvedValueOnce({voiceStates: []});
		await expect(state.service.play(state.user, channelId, {sound_id: 1n})).rejects.toThrow();
		state.gateway.checkPermission.mockResolvedValue(false);
		await expect(state.service.play(state.user, channelId, {sound_id: 1n})).rejects.toThrow();
		expect(state.gateway.dispatchPresence).not.toHaveBeenCalled();
	});
	it('allows default sounds without a subscription or a source server', async () => {
		await state.service.play(state.user, channelId, {sound_id: 1n});
		expect(state.gateway.dispatchPresence).toHaveBeenCalledTimes(2);
	});
	it('requires membership, premium and Use External Sounds for cross-server playback', async () => {
		await state.service.create(state.user, otherGuildId, {name: 'Test', sound: validAudio}, null);
		await expect(
			state.service.play(state.user, channelId, {sound_id: soundId, source_guild_id: otherGuildId}),
		).rejects.toThrow();
		vi.mocked(state.user.isPremium).mockReturnValue(true);
		state.gateway.checkPermission.mockImplementation(
			async ({permission}) => permission !== Permissions.USE_EXTERNAL_SOUNDS,
		);
		await expect(
			state.service.play(state.user, channelId, {sound_id: soundId, source_guild_id: otherGuildId}),
		).rejects.toThrow();
		state.gateway.checkPermission.mockResolvedValue(true);
		state.gateway.getGuildData.mockRejectedValueOnce(new Error('Not a member'));
		await expect(
			state.service.play(state.user, channelId, {sound_id: soundId, source_guild_id: otherGuildId}),
		).rejects.toThrow();
		await state.service.play(state.user, channelId, {sound_id: soundId, source_guild_id: otherGuildId});
		expect(state.gateway.dispatchPresence).toHaveBeenCalledTimes(2);
	});
	it('validates the public name, volume and emoji contract', () => {
		expect(GuildSoundboardCreateRequest.safeParse({name: 'x', sound: validAudio}).success).toBe(false);
		expect(GuildSoundboardCreateRequest.safeParse({name: 'ok', sound: validAudio, volume: 1.01}).success).toBe(false);
		expect(GuildSoundboardUpdateRequest.safeParse({emoji_id: '123', emoji_name: '🦆'}).success).toBe(false);
		expect(GuildSoundboardUpdateRequest.safeParse({volume: 0}).success).toBe(true);
		expect(GuildSoundboardUpdateRequest.safeParse({emoji_name: 'not an emoji'}).success).toBe(false);
	});
	it('purges only the deleted guild’s sounds and queues their files for cleanup', async () => {
		await create();
		await state.service.create(state.user, otherGuildId, {name: 'Other', sound: validAudio}, null);
		await state.service.purgeGuild(guildId);
		expect(await state.repository.list(guildId)).toEqual([]);
		expect(await state.repository.list(otherGuildId)).toHaveLength(1);
		expect(state.deletions.queueDeletion).toHaveBeenCalledWith(
			expect.objectContaining({s3Key: 'soundboard-sounds/500', reason: 'guild_delete'}),
		);
	});
	it('returns 404 for unknown sound IDs', async () => {
		await expect(state.service.get(userId, guildId, soundId)).rejects.toMatchObject({status: 404});
	});
	it('rejects playback when an older gateway omits moderation flags', async () => {
		state.gateway.getVoiceStatesForChannel.mockResolvedValue({
			voiceStates: [{userId: userId.toString(), channelId: '200', connectionId: 'sender'}],
		});
		await expect(state.service.play(state.user, channelId, {sound_id: 1n})).rejects.toThrow();
		expect(state.gateway.dispatchPresence).not.toHaveBeenCalled();
	});
});
