// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	SOUNDBOARD_MAX_BASE64_LENGTH,
	SOUNDBOARD_NAME_MAX_LENGTH,
	SOUNDBOARD_NAME_MIN_LENGTH,
} from '@fluxer/constants/src/SoundboardConstants';
import {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {UnicodeRoleEmojiType} from '@fluxer/schema/src/primitives/EmojiValidators';
import {createStringType, SnowflakeStringType, SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

const fields = {
	name: createStringType(SOUNDBOARD_NAME_MIN_LENGTH, SOUNDBOARD_NAME_MAX_LENGTH),
	volume: z.number().min(0).max(1).nullable().optional(),
	emoji_id: SnowflakeType.nullable().optional(),
	emoji_name: UnicodeRoleEmojiType.nullable().optional(),
};

export const GuildSoundboardCreateRequest = z
	.object({
		...fields,
		sound: z.string().max(SOUNDBOARD_MAX_BASE64_LENGTH),
	})
	.refine((data) => !(data.emoji_id && data.emoji_name), {message: 'Choose one emoji', path: ['emoji_name']});
export type GuildSoundboardCreateRequest = z.infer<typeof GuildSoundboardCreateRequest>;

export const GuildSoundboardUpdateRequest = z
	.object(fields)
	.partial()
	.refine((data) => !(data.emoji_id && data.emoji_name), {message: 'Choose one emoji', path: ['emoji_name']});
export type GuildSoundboardUpdateRequest = z.infer<typeof GuildSoundboardUpdateRequest>;

export const GuildSoundboardParam = z.object({guild_id: SnowflakeType, sound_id: SnowflakeType});
export const SendSoundboardSoundRequest = z.object({
	sound_id: SnowflakeType,
	source_guild_id: SnowflakeType.optional(),
});
export type SendSoundboardSoundRequest = z.infer<typeof SendSoundboardSoundRequest>;

export const SoundboardSoundResponse = z.object({
	sound_id: SnowflakeStringType,
	name: z.string(),
	volume: z.number(),
	emoji_id: SnowflakeStringType.nullable(),
	emoji_name: z.string().nullable(),
	guild_id: SnowflakeStringType.optional(),
	available: z.boolean(),
	user_id: SnowflakeStringType.optional(),
	user: UserPartialResponse.optional(),
	url: z.string(),
	duration_ms: z.number().optional(),
});
export type SoundboardSoundResponse = z.infer<typeof SoundboardSoundResponse>;
export const GuildSoundboardListResponse = z.object({items: z.array(SoundboardSoundResponse)});
export const DefaultSoundboardListResponse = z.array(SoundboardSoundResponse);
