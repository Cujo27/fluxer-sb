// SPDX-License-Identifier: AGPL-3.0-or-later

export const SOUNDBOARD_MAX_BYTES = 512 * 1024;
export const SOUNDBOARD_MAX_DURATION_MS = 5200;
export const SOUNDBOARD_MAX_SOUNDS = 8;
export const SOUNDBOARD_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const SOUNDBOARD_DURATION_MAX_MS = 60_000;
export const SOUNDBOARD_MIN_DURATION_MS = 100;
export const SOUNDBOARD_MAX_BASE64_LENGTH = 4 * Math.ceil(SOUNDBOARD_UPLOAD_MAX_BYTES / 3) + 64;
export const SOUNDBOARD_ACCEPTED_FILE_TYPES = '.mp3,.ogg,.wav,audio/mpeg,audio/ogg,audio/wav,audio/x-wav';

export type SoundboardAudioContentType = 'audio/mpeg' | 'audio/ogg' | 'audio/wav';

export function soundboardAudioContentTypeFromFilename(filename: string): SoundboardAudioContentType | null {
	switch (filename.toLowerCase().split('.').pop()) {
		case 'mp3':
			return 'audio/mpeg';
		case 'ogg':
			return 'audio/ogg';
		case 'wav':
			return 'audio/wav';
		default:
			return null;
	}
}

export function normalizeSoundboardAudioContentType(value: string): SoundboardAudioContentType | null {
	switch (value.toLowerCase().split(';', 1)[0]?.trim()) {
		case 'audio/mpeg':
		case 'audio/mp3':
			return 'audio/mpeg';
		case 'audio/ogg':
			return 'audio/ogg';
		case 'audio/wav':
		case 'audio/wave':
		case 'audio/x-wav':
			return 'audio/wav';
		default:
			return null;
	}
}

// Check container signatures before decoding. The media service/browser still
// has to decode the audio; a filename or declared MIME type is not sufficient.
export function detectSoundboardAudioContentType(bytes: Uint8Array): SoundboardAudioContentType | null {
	const startsWith = (offset: number, value: string) =>
		value.split('').every((char, index) => bytes[offset + index] === char.charCodeAt(0));
	if (bytes.length >= 12 && startsWith(0, 'RIFF') && startsWith(8, 'WAVE')) return 'audio/wav';
	if (bytes.length >= 27 && startsWith(0, 'OggS') && bytes[4] === 0) {
		const packetOffset = 27 + bytes[26]!;
		if (startsWith(packetOffset, 'OpusHead') || startsWith(packetOffset, '\x01vorbis')) return 'audio/ogg';
		return null;
	}
	if (bytes.length >= 10 && startsWith(0, 'ID3')) return 'audio/mpeg';
	if (
		bytes.length >= 4 &&
		bytes[0] === 0xff &&
		(bytes[1]! & 0xe0) === 0xe0 &&
		(bytes[1]! & 0x18) !== 0x08 &&
		(bytes[1]! & 0x06) === 0x02 &&
		(bytes[2]! & 0xf0) !== 0xf0 &&
		(bytes[2]! & 0x0c) !== 0x0c
	)
		return 'audio/mpeg';
	return null;
}
export const SOUNDBOARD_NAME_MIN_LENGTH = 2;
export const SOUNDBOARD_NAME_MAX_LENGTH = 32;

export const DEFAULT_SOUNDBOARD_SOUNDS = [
	{sound_id: '1', name: 'Quack', emoji_name: '🦆'},
	{sound_id: '2', name: 'Airhorn', emoji_name: '📣'},
	{sound_id: '3', name: 'Cricket', emoji_name: '🦗'},
	{sound_id: '4', name: 'Golf clap', emoji_name: '👏'},
	{sound_id: '5', name: 'Sad horn', emoji_name: '🎺'},
	{sound_id: '6', name: 'Ba dum tss', emoji_name: '🥁'},
] as const;
