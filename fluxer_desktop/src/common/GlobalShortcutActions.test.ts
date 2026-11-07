// SPDX-License-Identifier: AGPL-3.0-or-later

import {globalShortcutEventRevealsWindow, isGlobalShortcutAction} from '@electron/common/GlobalShortcutActions';
import {portalDefinitionsFromStored, sanitizeGlobalShortcutsSyncPayload} from '@electron/main/GlobalShortcutsEngine';
import {describe, expect, it} from 'vitest';

describe('desktop soundboard shortcut', () => {
	it('accepts the renderer action through native shortcut synchronization', () => {
		const combo = {key: 'b', ctrl: true, shift: true};
		const payload = sanitizeGlobalShortcutsSyncPayload({
			bindings: [{sourceId: 'soundboard', action: 'voice_toggle_soundboard', combo}],
			actions: [{action: 'voice_toggle_soundboard', description: 'Open soundboard', preferredCombo: combo}],
		});
		expect(isGlobalShortcutAction('voice_toggle_soundboard')).toBe(true);
		expect(payload?.actions).toContainEqual(expect.objectContaining({action: 'voice_toggle_soundboard'}));
		expect(payload?.bindings).toContainEqual(expect.objectContaining({action: 'voice_toggle_soundboard'}));
	});
	it('offers the action to the Wayland portal even before a shortcut has been saved', () => {
		expect(portalDefinitionsFromStored([])).toContainEqual({
			id: 'voice_toggle_soundboard',
			description: 'Open soundboard',
		});
	});
	it('reveals the window for a press, without reopening it on release or for an unknown IPC event', () => {
		expect(
			globalShortcutEventRevealsWindow('global-shortcut-event', {action: 'voice_toggle_soundboard', phase: 'press'}),
		).toBe(true);
		expect(
			globalShortcutEventRevealsWindow('global-shortcut-event', {action: 'voice_toggle_soundboard', phase: 'release'}),
		).toBe(false);
		expect(
			globalShortcutEventRevealsWindow('untrusted-event', {action: 'voice_toggle_soundboard', phase: 'press'}),
		).toBe(false);
		expect(isGlobalShortcutAction('voice_play_arbitrary_file')).toBe(false);
	});
});
