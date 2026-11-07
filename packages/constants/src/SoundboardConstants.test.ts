// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {
	detectSoundboardAudioContentType,
	normalizeSoundboardAudioContentType,
	soundboardAudioContentTypeFromFilename,
} from './SoundboardConstants';

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
function ogg(packet: string): Uint8Array {
	const bytes = new Uint8Array(28 + packet.length);
	bytes.set(ascii('OggS'));
	bytes[26] = 1;
	bytes[27] = packet.length;
	bytes.set(ascii(packet), 28);
	return bytes;
}

describe('supported soundboard formats', () => {
	it.each([
		[Uint8Array.from([0xff, 0xfb, 0x90, 0x64]), 'audio/mpeg'],
		[ascii('ID3\x04\0\0\0\0\0\0'), 'audio/mpeg'],
		[ascii('RIFF\0\0\0\0WAVE'), 'audio/wav'],
		[ogg('OpusHead'), 'audio/ogg'],
		[ogg('\x01vorbis'), 'audio/ogg'],
	])('recognizes supported audio headers', (bytes, mime) => {
		expect(detectSoundboardAudioContentType(bytes)).toBe(mime);
	});
	it.each([
		new Uint8Array(),
		ascii('....ftypM4A ....'),
		ascii('fLaC....'),
		ascii('RIFF\0\0\0\0AVI '),
		ogg('\x80theora'),
		Uint8Array.from([0xff, 0xfd, 0x90, 0x64]),
	])('rejects other containers and codecs', (bytes) => {
		expect(detectSoundboardAudioContentType(bytes)).toBeNull();
	});
	it('accepts supported filename and MIME aliases while rejecting renamed videos', () => {
		expect(soundboardAudioContentTypeFromFilename('CLIP.MP3')).toBe('audio/mpeg');
		expect(soundboardAudioContentTypeFromFilename('clip.mp4')).toBeNull();
		expect(soundboardAudioContentTypeFromFilename('clip.mp3.exe')).toBeNull();
		expect(normalizeSoundboardAudioContentType('audio/x-wav')).toBe('audio/wav');
		expect(normalizeSoundboardAudioContentType('video/ogg')).toBeNull();
		expect(normalizeSoundboardAudioContentType('audio/mp4')).toBeNull();
	});
});
