// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createGuildID, createSoundboardSoundID} from '@app/api/BrandedTypes';
import {LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {RequestBodyLimit} from '@app/api/middleware/RequestBodyLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {Validator} from '@app/api/Validator';
import {SOUNDBOARD_MAX_BASE64_LENGTH} from '@fluxer/constants/src/SoundboardConstants';
import {ChannelIdParam, GuildIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	DefaultSoundboardListResponse,
	GuildSoundboardCreateRequest,
	GuildSoundboardListResponse,
	GuildSoundboardParam,
	GuildSoundboardUpdateRequest,
	SendSoundboardSoundRequest,
	SoundboardSoundResponse,
} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';

export function GuildSoundboardController(app: HonoApp) {
	app.get(
		'/soundboard-default-sounds',
		LoginRequired,
		RateLimitMiddleware(RateLimitConfigs.SOUNDBOARD_READ),
		OpenAPI({
			operationId: 'list_default_soundboard_sounds',
			summary: 'List default soundboard sounds',
			description: 'Returns the sounds available to every user.',
			responseSchema: DefaultSoundboardListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Soundboard'],
		}),
		async (ctx) => ctx.json(ctx.get('soundboardService').defaults()),
	);
	app.get(
		'/guilds/:guild_id/soundboard-sounds',
		LoginRequired,
		RateLimitMiddleware(RateLimitConfigs.SOUNDBOARD_READ),
		Validator('param', GuildIdParam),
		OpenAPI({
			operationId: 'list_guild_soundboard_sounds',
			summary: 'List guild soundboard sounds',
			description: 'Returns the sound library for a server the caller belongs to.',
			responseSchema: GuildSoundboardListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Soundboard'],
		}),
		async (ctx) =>
			ctx.json({
				items: await ctx
					.get('soundboardService')
					.list(ctx.get('user').id, createGuildID(ctx.req.valid('param').guild_id)),
			}),
	);
	app.get(
		'/guilds/:guild_id/soundboard-sounds/:sound_id',
		LoginRequired,
		RateLimitMiddleware(RateLimitConfigs.SOUNDBOARD_READ),
		Validator('param', GuildSoundboardParam),
		OpenAPI({
			operationId: 'get_guild_soundboard_sound',
			summary: 'Get guild soundboard sound',
			description: 'Returns one sound from a server the caller belongs to.',
			responseSchema: SoundboardSoundResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Soundboard'],
		}),
		async (ctx) => {
			const p = ctx.req.valid('param');
			return ctx.json(
				await ctx
					.get('soundboardService')
					.get(ctx.get('user').id, createGuildID(p.guild_id), createSoundboardSoundID(p.sound_id)),
			);
		},
	);
	app.post(
		'/guilds/:guild_id/soundboard-sounds',
		LoginRequired,
		RequestBodyLimit(SOUNDBOARD_MAX_BASE64_LENGTH + 4096),
		RateLimitMiddleware(RateLimitConfigs.SOUNDBOARD_CREATE),
		Validator('param', GuildIdParam),
		Validator('json', GuildSoundboardCreateRequest),
		OpenAPI({
			operationId: 'create_guild_soundboard_sound',
			summary: 'Create guild soundboard sound',
			description: 'Requires Create Expressions. Validates sound format, size, duration and server quota.',
			requestSchema: GuildSoundboardCreateRequest,
			responseSchema: SoundboardSoundResponse,
			statusCode: 201,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Soundboard'],
		}),
		async (ctx) =>
			ctx.json(
				await ctx
					.get('soundboardService')
					.create(
						ctx.get('user'),
						createGuildID(ctx.req.valid('param').guild_id),
						ctx.req.valid('json'),
						ctx.get('auditLogReason') ?? null,
					),
				201,
			),
	);
	app.patch(
		'/guilds/:guild_id/soundboard-sounds/:sound_id',
		LoginRequired,
		RateLimitMiddleware(RateLimitConfigs.SOUNDBOARD_MUTATE),
		Validator('param', GuildSoundboardParam),
		Validator('json', GuildSoundboardUpdateRequest),
		OpenAPI({
			operationId: 'modify_guild_soundboard_sound',
			summary: 'Modify guild soundboard sound',
			description: 'Requires Create Expressions for the caller’s own sound, or Manage Expressions for any sound.',
			requestSchema: GuildSoundboardUpdateRequest,
			responseSchema: SoundboardSoundResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Soundboard'],
		}),
		async (ctx) => {
			const p = ctx.req.valid('param');
			return ctx.json(
				await ctx
					.get('soundboardService')
					.update(
						ctx.get('user').id,
						createGuildID(p.guild_id),
						createSoundboardSoundID(p.sound_id),
						ctx.req.valid('json'),
						ctx.get('auditLogReason') ?? null,
					),
			);
		},
	);
	app.delete(
		'/guilds/:guild_id/soundboard-sounds/:sound_id',
		LoginRequired,
		RateLimitMiddleware(RateLimitConfigs.SOUNDBOARD_MUTATE),
		Validator('param', GuildSoundboardParam),
		OpenAPI({
			operationId: 'delete_guild_soundboard_sound',
			summary: 'Delete guild soundboard sound',
			description: 'Deletes an owned sound with Create Expressions or any sound with Manage Expressions.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Soundboard'],
		}),
		async (ctx) => {
			const p = ctx.req.valid('param');
			await ctx
				.get('soundboardService')
				.delete(
					ctx.get('user').id,
					createGuildID(p.guild_id),
					createSoundboardSoundID(p.sound_id),
					ctx.get('auditLogReason') ?? null,
				);
			return ctx.body(null, 204);
		},
	);
	app.post(
		'/channels/:channel_id/send-soundboard-sound',
		LoginRequired,
		RateLimitMiddleware(RateLimitConfigs.SOUNDBOARD_PLAY),
		Validator('param', ChannelIdParam),
		Validator('json', SendSoundboardSoundRequest),
		OpenAPI({
			operationId: 'send_soundboard_sound',
			summary: 'Send soundboard sound',
			description: 'Plays a sound in the connected voice channel. Enforces voice state and channel permissions.',
			requestSchema: SendSoundboardSoundRequest,
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Soundboard'],
		}),
		async (ctx) => {
			await ctx
				.get('soundboardService')
				.play(ctx.get('user'), createChannelID(ctx.req.valid('param').channel_id), ctx.req.valid('json'));
			return ctx.body(null, 204);
		},
	);
}
