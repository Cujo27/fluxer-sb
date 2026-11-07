// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {ResettableStates} from '@app/features/app/state/ResettableStates';
import {http} from '@app/features/platform/transport/RestTransport';
import type {SoundboardSoundResponse} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {makeAutoObservable, runInAction} from 'mobx';

export type SoundboardSound = SoundboardSoundResponse;
export type SoundboardEdit = {name: string; volume: number; emoji_id: string | null; emoji_name: string | null};

class SoundboardLibrary {
	defaults: Array<SoundboardSound> = [];
	guildSounds: Record<string, Array<SoundboardSound>> = {};
	private generation = 0;
	private changesDuringLoad = new Map<string, Map<string, SoundboardSound | null>>();
	private pending = new Map<string, Promise<void>>();
	constructor() {
		makeAutoObservable<this, 'generation' | 'changesDuringLoad' | 'pending'>(
			this,
			{generation: false, changesDuringLoad: false, pending: false},
			{autoBind: true},
		);
	}
	async loadDefaults(): Promise<void> {
		if (this.defaults.length) return;
		const generation = this.generation;
		const response = await http.get<Array<SoundboardSound>>(Endpoints.SOUNDBOARD_DEFAULT_SOUNDS);
		runInAction(() => {
			if (this.generation === generation) this.defaults = response.body;
		});
	}
	async loadGuild(guildId: string): Promise<void> {
		const pending = this.pending.get(guildId);
		if (pending) return pending;
		const generation = this.generation;
		const changes = new Map<string, SoundboardSound | null>();
		this.changesDuringLoad.set(guildId, changes);
		const request = http
			.get<{items: Array<SoundboardSound>}>(Endpoints.GUILD_SOUNDBOARD_SOUNDS(guildId))
			.then((response) => {
				runInAction(() => {
					if (generation !== this.generation) return;
					const sounds = new Map(response.body.items.map((sound) => [sound.sound_id, sound]));
					for (const [id, sound] of changes) {
						if (sound) sounds.set(id, sound);
						else sounds.delete(id);
					}
					this.guildSounds[guildId] = [...sounds.values()];
				});
			})
			.finally(() => {
				runInAction(() => {
					if (generation === this.generation) {
						this.pending.delete(guildId);
						this.changesDuringLoad.delete(guildId);
					}
				});
			});
		this.pending.set(guildId, request);
		return request;
	}
	upsert(sound: SoundboardSound): void {
		if (!sound.guild_id) return;
		const guildId = sound.guild_id;
		this.changesDuringLoad.get(guildId)?.set(sound.sound_id, sound);
		const sounds = this.guildSounds[guildId] ?? [];
		this.guildSounds[guildId] = [...sounds.filter((item) => item.sound_id !== sound.sound_id), sound];
	}
	remove(guildId: string, soundId: string): void {
		this.changesDuringLoad.get(guildId)?.set(soundId, null);
		this.guildSounds[guildId] = (this.guildSounds[guildId] ?? []).filter((sound) => sound.sound_id !== soundId);
	}
	async save(guildId: string, data: SoundboardEdit, sound?: string, soundId?: string): Promise<void> {
		const generation = this.generation;
		const response = soundId
			? await http.patch<SoundboardSound>(Endpoints.GUILD_SOUNDBOARD_SOUND(guildId, soundId), {body: data})
			: await http.post<SoundboardSound>(Endpoints.GUILD_SOUNDBOARD_SOUNDS(guildId), {body: {...data, sound}});
		if (this.generation === generation) this.upsert(response.body);
	}
	async delete(guildId: string, soundId: string): Promise<void> {
		const generation = this.generation;
		await http.delete(Endpoints.GUILD_SOUNDBOARD_SOUND(guildId, soundId));
		if (this.generation === generation) this.remove(guildId, soundId);
	}
	async play(channelId: string, sound: SoundboardSound): Promise<void> {
		await http.post(Endpoints.CHANNEL_SEND_SOUNDBOARD_SOUND(channelId), {
			body: {sound_id: sound.sound_id, ...(sound.guild_id ? {source_guild_id: sound.guild_id} : {})},
		});
	}
	reset(): void {
		this.generation++;
		this.defaults = [];
		this.guildSounds = {};
		this.pending.clear();
		this.changesDuringLoad.clear();
	}
}

const library = new SoundboardLibrary();
ResettableStates.register(library, () => library.reset());
export default library;
