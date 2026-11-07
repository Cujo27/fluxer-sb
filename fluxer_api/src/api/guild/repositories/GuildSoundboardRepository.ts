// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GuildID, SoundboardSoundID, UserID} from '@app/api/BrandedTypes';
import {deleteOneOrMany, fetchMany, fetchOne, upsertOne} from '@app/api/database/CassandraQueryExecution';
import {defineTable} from '@app/api/database/CassandraTableDsl';

export interface GuildSoundboardRow {
	guild_id: GuildID;
	sound_id: SoundboardSoundID;
	creator_id: UserID;
	name: string;
	volume: number;
	emoji_id: bigint | null;
	emoji_name: string | null;
	content_type: string;
	duration_ms: number;
}

export const GuildSoundboardSounds = defineTable<GuildSoundboardRow, 'guild_id' | 'sound_id', 'guild_id'>({
	name: 'guild_soundboard_sounds',
	columns: [
		'guild_id',
		'sound_id',
		'creator_id',
		'name',
		'volume',
		'emoji_id',
		'emoji_name',
		'content_type',
		'duration_ms',
	],
	primaryKey: ['guild_id', 'sound_id'],
	partitionKey: ['guild_id'],
});

export class GuildSoundboardRepository {
	async list(guildId: GuildID): Promise<Array<GuildSoundboardRow>> {
		return fetchMany<GuildSoundboardRow>(
			GuildSoundboardSounds.select({where: GuildSoundboardSounds.where.eq('guild_id')}).bind({guild_id: guildId}),
		);
	}
	async get(guildId: GuildID, soundId: SoundboardSoundID): Promise<GuildSoundboardRow | null> {
		return fetchOne<GuildSoundboardRow>(
			GuildSoundboardSounds.select({
				where: [GuildSoundboardSounds.where.eq('guild_id'), GuildSoundboardSounds.where.eq('sound_id')],
				limit: 1,
			}).bind({guild_id: guildId, sound_id: soundId}),
		);
	}
	async save(row: GuildSoundboardRow): Promise<void> {
		await upsertOne(GuildSoundboardSounds.upsertAll(row));
	}
	async delete(guildId: GuildID, soundId: SoundboardSoundID): Promise<void> {
		await deleteOneOrMany(GuildSoundboardSounds.deleteByPk({guild_id: guildId, sound_id: soundId}));
	}
}
