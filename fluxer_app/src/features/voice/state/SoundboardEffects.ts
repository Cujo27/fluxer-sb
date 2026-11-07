// SPDX-License-Identifier: AGPL-3.0-or-later

import {makeAutoObservable} from 'mobx';

export interface SoundboardEffect {
	channel_id: string;
	user_id: string;
	emoji_id?: string | null;
	emoji_name?: string | null;
}

class SoundboardEffects {
	effects: Record<string, SoundboardEffect & {token: number}> = {};
	private nextToken = 0;
	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}
	start(effect: SoundboardEffect): number {
		const token = ++this.nextToken;
		this.effects[`${effect.channel_id}:${effect.user_id}`] = {...effect, token};
		return token;
	}
	stop(effect: SoundboardEffect, token: number): void {
		const key = `${effect.channel_id}:${effect.user_id}`;
		if (this.effects[key]?.token === token) delete this.effects[key];
	}
	get(channelId: string | null | undefined, userId: string): SoundboardEffect | undefined {
		return this.effects[`${channelId}:${userId}`];
	}
}

export default new SoundboardEffects();
