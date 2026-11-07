// SPDX-License-Identifier: AGPL-3.0-or-later

import {beforeEach, describe, expect, it, vi} from 'vitest';

const {get, post} = vi.hoisted(() => ({get: vi.fn(), post: vi.fn()}));
vi.mock('@app/features/platform/transport/RestTransport', () => ({http: {get, post}}));
vi.mock('@app/features/app/state/ResettableStates', () => ({ResettableStates: {register: vi.fn()}}));

import library, {type SoundboardSound} from '@app/features/voice/state/SoundboardLibrary';

const sound = (id: string, name = id): SoundboardSound => ({
	sound_id: id,
	guild_id: '100',
	name,
	volume: 1,
	available: true,
	emoji_id: null,
	emoji_name: null,
	url: `/soundboard-sounds/${id}`,
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return {promise, resolve};
}

describe('SoundboardLibrary', () => {
	beforeEach(() => {
		library.reset();
		vi.clearAllMocks();
	});
	it('merges live creates, updates and deletes into an in-flight library read', async () => {
		const response = deferred<{body: {items: Array<SoundboardSound>}}>();
		get.mockReturnValue(response.promise);
		const loading = library.loadGuild('100');
		library.upsert(sound('2', 'Updated'));
		library.upsert(sound('4', 'Created'));
		library.remove('100', '3');
		response.resolve({body: {items: [sound('1'), sound('2', 'Old'), sound('3')]}});
		await loading;
		expect(library.guildSounds['100'].map(({sound_id, name}) => [sound_id, name])).toEqual([
			['1', '1'],
			['2', 'Updated'],
			['4', 'Created'],
		]);
	});
	it('shares concurrent guild reads', async () => {
		get.mockResolvedValue({body: {items: []}});
		await Promise.all([library.loadGuild('100'), library.loadGuild('100')]);
		expect(get).toHaveBeenCalledTimes(1);
	});
	it('ignores old account reads and mutations after an account reset', async () => {
		const response = deferred<{body: {items: Array<SoundboardSound>}}>();
		const saved = deferred<{body: SoundboardSound}>();
		get.mockReturnValue(response.promise);
		post.mockReturnValue(saved.promise);
		const loading = library.loadGuild('100');
		const saving = library.save(
			'100',
			{name: 'Test', volume: 1, emoji_id: null, emoji_name: null},
			'data:audio/ogg;base64,YQ==',
		);
		library.reset();
		response.resolve({body: {items: [sound('1')]}});
		saved.resolve({body: sound('2')});
		await Promise.all([loading, saving]);
		expect(library.guildSounds).toEqual({});
	});
});
