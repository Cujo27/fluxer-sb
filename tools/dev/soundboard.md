# Soundboard

The voice toolbar and connected voice panel open the soundboard picker. Manage
server sounds in **Community settings → Expressions → Soundboard**. Listener
volume is in **User settings → Voice & Video → Soundboard** and in the picker.

## Rollout

1. Apply the Cassandra schema using `pnpm dev:cassandra:diff`,
   `pnpm dev:cassandra:apply`, and `pnpm dev:cassandra:verify`. The new table is
   `guild_soundboard_sounds`, partitioned by guild and clustered by sound ID.
2. Deploy the API, gateway, media proxy, static files, admin and app together. Rebuild
   the static image: it includes `/soundboard/1.wav` through `/soundboard/6.wav`.
   Restarting an older image will not add the bundled sounds. The
   gateway voice-state RPC now carries moderation and deafen flags; deploy it
   before accepting soundboard playback requests. The media proxy serves
   `/soundboard-sounds/{sound_id}` from the CDN bucket.
3. Existing roles retain their permissions. Administrators can enable **Use
   Soundboard** (bit 42) and **Use External Sounds** (bit 45) in role/channel
   settings. New servers enable both in their default permissions. Uploading
   requires **Create Expressions**; managing other members’ sounds requires
   **Manage Expressions**.

The six bundled effects are original synthesized WAV files. Regenerate them with
`node tools/GenerateSoundboardDefaults.mjs`. They use Discord's conventional
default sound names and IDs without copying its recordings. Custom uploads use
MP3, OGG (Opus/Vorbis), or WAV. File extensions, declared MIME types and content
signatures are checked before trimming; the API independently checks the audio
signature, detected media type, measured duration and decoded byte length.
External server sounds require premium and
the destination channel's Use External Sounds permission.

## Admin settings

Open **Admin → Limit Configuration → Soundboard**. These settings use the same
persisted rules and server feature filters as emoji/sticker limits, and propagate
to the app's quota labels, upload limits and trimmer:

| Setting | Key | Default | Range |
| --- | --- | --- | --- |
| Max Soundboard Sounds | `max_guild_soundboard_sounds` | 8 | Nonnegative integer; 0 disables new uploads |
| Soundboard Max Upload Size | `soundboard_max_size` | 524288 bytes (512 KiB) | 1–26214400 bytes (25 MiB) |
| Soundboard Max Duration (ms) | `soundboard_max_duration_ms` | 5200 ms (5.2 seconds) | 100–60000 ms |

The size limit applies to the uploaded clip after trimming. Input files for the
browser trimmer are limited to 25 MiB. Lowering a limit preserves existing sounds;
the new limits apply to new uploads.

## Verification

Run `pnpm --filter fluxer_api test src/api/guild/tests/SoundboardService.test.ts src/api/admin/tests/SoundboardLimitConfig.test.ts`
and `pnpm --filter fluxer_app test`. The tests cover storage, permissions,
concurrent quota enforcement, voice-state restrictions, event delivery,
account-switch races, live updates during loading and audio cancellation.

For a live smoke test, join the same channel with two accounts, upload and trim a
sound, play it from both toolbar locations, and confirm that the second account
hears it. Check preview isolation, listener volume, local mute, deafen,
disconnect, denied channel permissions, external-server playback, live edits and
deletion. Gateway and media-proxy changes also need their normal Erlang and Rust
checks. A frontend build requires the repository's generated WASM modules.

Check `/soundboard/1.wav` through the public app origin as well as the static
container. It must return WAV audio, not the SPA's HTML shell with HTTP 200.
Development uses the app proxy's static-prefix list; Compose and Helm use the
edge Caddyfile's static-asset matcher. Both include `/soundboard/`. Restart the
app proxy after updating it and reload the edge configuration when deploying.

Rolling back the code can leave the additive table and permission bits in place;
older code ignores them. Preserve the table and stored assets to keep uploaded
sounds available when upgrading again.

## Desktop

The desktop renderer uses the shared soundboard UI and voice audio context.
Default sounds load from the selected instance's static CDN, and uploaded sounds
from its media endpoint, through the existing authenticated resource proxy.
WAV files are supported by the local renderer's file handler as well.

In **User settings → Keybinds**, assign **Toggle the soundboard** and enable
**Global** to use it while another application has focus. A press restores the
desktop window and toggles the picker. The action is available to the native
Windows/macOS hooks and Linux shortcut backends, including the Wayland portal,
and works in fullscreen call views. The focused Ctrl/Cmd+Shift+B shortcut remains
available without enabling a global binding.

Rebuild the desktop shell and renderer to install these changes. A renderer-only
update cannot add an action to an older shell's native shortcut registry.
Run `pnpm --filter fluxer_desktop test` for shortcut and resource-proxy regression
checks, including credential stripping, origin restrictions, WAV handling and
default/custom sound URLs.
