// SPDX-License-Identifier: AGPL-3.0-or-later

import {wrapDesktopLocalResourceURL} from '@app/features/messaging/utils/DesktopResourceUrl';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {
	getSharedVoiceAudioContext,
	setVoiceAudioContextOutput,
} from '@app/features/voice/engine/VoiceSharedAudioContext';
import VoiceSettings from '@app/features/voice/state/VoiceSettings';
import {reaction} from 'mobx';

const logger = new Logger('VoiceClipPlayer');
const selectedOutputs = new WeakMap<AudioContext, string>();

export class VoiceClipPlayer {
	private buffers = new Map<string, AudioBuffer>();
	private active = new Set<() => void>();
	private generation = 0;

	private ensureContext(): AudioContext {
		const context = getSharedVoiceAudioContext();
		if (!context) throw new Error('Audio playback is unavailable');
		return context;
	}

	private async fetchBuffer(url: string): Promise<AudioBuffer> {
		const cached = this.buffers.get(url);
		if (cached) {
			this.buffers.delete(url);
			this.buffers.set(url, cached);
			return cached;
		}
		const resourceUrl = wrapDesktopLocalResourceURL(url);
		let response = await fetch(resourceUrl, {cache: 'force-cache'});
		// Misrouted defaults may have cached a 404 or the SPA's HTML (HTTP 200).
		// Revalidate both so corrected routing also fixes existing clients.
		if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
			response = await fetch(resourceUrl, {cache: 'reload'});
		}
		if (!response.ok) throw new Error(`Could not load audio (${response.status})`);
		if (response.headers.get('content-type')?.includes('text/html'))
			throw new Error('The audio URL returned an HTML page');
		const buffer = await this.ensureContext().decodeAudioData(await response.arrayBuffer());
		this.buffers.set(url, buffer);
		while (this.buffers.size > 32) this.buffers.delete(this.buffers.keys().next().value!);
		return buffer;
	}

	async play(options: {
		url: string;
		gain: () => number;
		shouldPlay: () => boolean;
		onStart?: () => void;
		onEnd?: () => void;
	}): Promise<void> {
		if (!options.shouldPlay()) return;
		const generation = this.generation;
		const context = this.ensureContext();
		// Bound pending downloads and playing clips together.
		if (this.active.size >= 16) this.active.values().next().value?.();
		let source: AudioBufferSourceNode | null = null;
		let gain: GainNode | null = null;
		let dispose = () => {};
		let finished = false;
		let started = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			dispose();
			this.active.delete(stop);
			source?.disconnect();
			gain?.disconnect();
			if (started) options.onEnd?.();
		};
		const stop = () => {
			try {
				if (started) source?.stop();
			} finally {
				finish();
			}
		};
		this.active.add(stop);
		const applyGain = (value: number) =>
			gain?.gain.setValueAtTime(Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 0, context.currentTime);
		dispose = reaction(
			() => ({allowed: options.shouldPlay(), gain: options.gain(), device: VoiceSettings.getOutputDeviceId()}),
			({allowed, gain: value, device}) => {
				if (!allowed) {
					stop();
					return;
				}
				applyGain(value);
				const sinkId = !device || device === 'default' ? '' : device;
				if (selectedOutputs.get(context) !== sinkId) {
					selectedOutputs.set(context, sinkId);
					void setVoiceAudioContextOutput(context, sinkId).catch((error) => {
						if (selectedOutputs.get(context) === sinkId) selectedOutputs.delete(context);
						logger.debug('Could not select soundboard audio output', {error});
					});
				}
			},
			{fireImmediately: true},
		);
		if (finished) {
			dispose();
			return;
		}
		try {
			// Resume during the click gesture, before waiting for the network.
			await context.resume();
			if (finished) return;
			const buffer = await this.fetchBuffer(options.url);
			if (finished || generation !== this.generation || !options.shouldPlay()) {
				finish();
				return;
			}
			source = context.createBufferSource();
			gain = context.createGain();
			source.buffer = buffer;
			source.connect(gain).connect(context.destination);
			applyGain(options.gain());
			source.onended = finish;
			source.start();
			started = true;
			options.onStart?.();
		} catch (error) {
			stop();
			throw error;
		}
	}

	stopAll(): void {
		this.generation++;
		for (const stop of [...this.active]) stop();
	}
}
