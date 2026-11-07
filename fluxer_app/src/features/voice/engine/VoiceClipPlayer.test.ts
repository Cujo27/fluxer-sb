// SPDX-License-Identifier: AGPL-3.0-or-later

import {observable, runInAction} from 'mobx';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {sharedContext} = vi.hoisted(() => ({sharedContext: vi.fn()}));
vi.mock('@app/features/voice/engine/VoiceSharedAudioContext', () => ({
	getSharedVoiceAudioContext: sharedContext,
	setVoiceAudioContextOutput: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@app/features/voice/state/VoiceSettings', () => ({default: {getOutputDeviceId: () => 'default'}}));
vi.mock('@app/features/platform/utils/AppLogger', () => ({
	Logger: class {
		debug() {}
	},
}));
vi.mock('@app/features/messaging/utils/DesktopResourceUrl', () => ({
	wrapDesktopLocalResourceURL: (url: string) => url,
}));

import {VoiceClipPlayer} from '@app/features/voice/engine/VoiceClipPlayer';

function setup() {
	const source = {
		buffer: null,
		onended: null as (() => void) | null,
		start: vi.fn(),
		stop: vi.fn(),
		connect: vi.fn(),
		disconnect: vi.fn(),
	};
	const gain = {gain: {setValueAtTime: vi.fn()}, connect: vi.fn(), disconnect: vi.fn()};
	source.connect.mockReturnValue(gain);
	const context = {
		resume: vi.fn().mockResolvedValue(undefined),
		decodeAudioData: vi.fn().mockResolvedValue({duration: 1}),
		createBufferSource: vi.fn(() => source),
		createGain: vi.fn(() => gain),
		destination: {},
		currentTime: 0,
	};
	sharedContext.mockReturnValue(context);
	vi.stubGlobal(
		'fetch',
		vi
			.fn()
			.mockResolvedValue({
				ok: true,
				headers: new Headers({'content-type': 'audio/wav'}),
				arrayBuffer: async () => new ArrayBuffer(1),
			}),
	);
	const state = observable({allowed: true, volume: 0.5});
	const onStart = vi.fn();
	const onEnd = vi.fn();
	const player = new VoiceClipPlayer();
	const play = () =>
		player.play({url: '/test.wav', shouldPlay: () => state.allowed, gain: () => state.volume, onStart, onEnd});
	return {source, gain, context, state, player, play, onStart, onEnd};
}

describe('VoiceClipPlayer', () => {
	let test: ReturnType<typeof setup>;
	beforeEach(() => {
		test = setup();
	});
	afterEach(() => {
		test.player.stopAll();
		vi.unstubAllGlobals();
	});
	it('reacts immediately to volume and deafen/disconnect changes and releases audio nodes', async () => {
		await test.play();
		expect(test.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.5, 0);
		runInAction(() => {
			test.state.volume = 0;
		});
		expect(test.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
		runInAction(() => {
			test.state.allowed = false;
		});
		expect(test.source.stop).toHaveBeenCalledOnce();
		expect(test.source.disconnect).toHaveBeenCalledOnce();
		expect(test.onEnd).toHaveBeenCalledOnce();
		test.source.onended?.();
		expect(test.onEnd).toHaveBeenCalledOnce();
	});
	it('cancels pending playback even if the listener rejoins or undeafens before loading finishes', async () => {
		let resolve!: (value: unknown) => void;
		vi.mocked(fetch).mockReturnValue(
			new Promise<Response>((done) => {
				resolve = done as typeof resolve;
			}),
		);
		const playing = test.play();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		runInAction(() => {
			test.state.allowed = false;
		});
		runInAction(() => {
			test.state.allowed = true;
		});
		resolve({
			ok: true,
			headers: new Headers({'content-type': 'audio/wav'}),
			arrayBuffer: async () => new ArrayBuffer(1),
		});
		await playing;
		expect(test.source.start).not.toHaveBeenCalled();
		expect(test.onStart).not.toHaveBeenCalled();
	});
	it('cancels pending previews when a new preview or account replaces them', async () => {
		const playing = test.play();
		test.player.stopAll();
		await playing;
		expect(test.source.start).not.toHaveBeenCalled();
	});
	it('cleans up and reports decoding failures', async () => {
		test.context.decodeAudioData.mockRejectedValueOnce(new Error('Invalid audio'));
		await expect(test.play()).rejects.toThrow('Invalid audio');
		expect(test.onStart).not.toHaveBeenCalled();
		expect(test.source.start).not.toHaveBeenCalled();
	});
	it('recovers from cached missing-default responses after the static image is updated', async () => {
		vi.mocked(fetch).mockResolvedValueOnce({ok: false, status: 404} as Response);
		await test.play();
		expect(fetch).toHaveBeenNthCalledWith(2, '/test.wav', {cache: 'reload'});
		expect(test.source.start).toHaveBeenCalledOnce();
	});
	it('revalidates an HTML shell cached under a default sound URL before decoding', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response('<html>Fluxer</html>', {headers: {'content-type': 'text/html; charset=utf-8'}}),
		);
		await test.play();
		expect(fetch).toHaveBeenNthCalledWith(2, '/test.wav', {cache: 'reload'});
		expect(test.context.decodeAudioData).toHaveBeenCalledOnce();
		expect(test.source.start).toHaveBeenCalledOnce();
	});
	it('releases effects when audio finishes naturally', async () => {
		await test.play();
		test.source.onended?.();
		expect(test.onStart).toHaveBeenCalledOnce();
		expect(test.onEnd).toHaveBeenCalledOnce();
		expect(test.gain.disconnect).toHaveBeenCalledOnce();
	});
});
