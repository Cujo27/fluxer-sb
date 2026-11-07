// SPDX-License-Identifier: AGPL-3.0-or-later
// Original synthesized effects; no third-party recordings. Run from the repository root.
import {mkdirSync, writeFileSync} from 'node:fs';

const rate = 22050;
let seed = 42;
const noise = () => {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return seed / 2147483648 - 1;
};
const sine = (hz, t) => Math.sin(2 * Math.PI * hz * t);
const effects = [
	(t) => {
		const p = t % 0.32;
		return t < 0.85 ? Math.exp(-p * 14) * (sine(230 - p * 220, p) + 0.3 * sine(660, p)) : 0;
	},
	(t) =>
		t < 1.2
			? (Math.min(1, t * 50) *
					Math.min(1, (1.2 - t) * 20) *
					(sine(440, t) + 0.6 * sine(554.37, t) + 0.5 * sine(659.25, t))) /
				2
			: 0,
	(t) => (t < 1.5 ? sine(4200, t) * Math.max(0, sine(7, t)) ** 8 * Math.max(0, sine(35, t)) : 0),
	(t) => (t < 1.6 ? noise() * Math.exp(-(t % 0.28) * 70) : 0),
	(t) => {
		const notes = [392, 369.99, 349.23, 329.63];
		const f = notes[Math.min(3, Math.floor(t / 0.35))];
		return t < 1.65 ? (sine(f, t) + 0.25 * sine(2 * f, t)) * Math.min(1, (1.65 - t) * 10) : 0;
	},
	(t) =>
		t < 0.18
			? sine(100 - t * 180, t) * Math.exp(-t * 20)
			: t < 0.38
				? noise() * Math.exp(-(t - 0.18) * 30)
				: noise() * Math.exp(-(t - 0.38) * 5),
];
mkdirSync('fluxer_static/soundboard', {recursive: true});
effects.forEach((effect, index) => {
	const frames = rate * 2;
	const bytes = Buffer.alloc(44 + frames * 2);
	bytes.write('RIFF');
	bytes.writeUInt32LE(bytes.length - 8, 4);
	bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(rate, 24);
	bytes.writeUInt32LE(rate * 2, 28);
	bytes.writeUInt16LE(2, 32);
	bytes.writeUInt16LE(16, 34);
	bytes.write('data', 36);
	bytes.writeUInt32LE(frames * 2, 40);
	for (let i = 0; i < frames; i++)
		bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, effect(i / rate) * 0.45)) * 32767), 44 + i * 2);
	writeFileSync(`fluxer_static/soundboard/${index + 1}.wav`, bytes);
});
