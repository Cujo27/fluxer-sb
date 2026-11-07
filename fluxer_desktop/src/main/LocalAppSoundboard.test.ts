// SPDX-License-Identifier: AGPL-3.0-or-later

import {readFileSync} from 'node:fs';
import {isServedLocalAppExtension, localAppContentType} from '@electron/main/LocalAppMime';
import type {DesktopLocalAppProxyClient} from '@electron/main/LocalAppProxyClient';
import {DesktopLocalAppRemoteResourceRequestHandler} from '@electron/main/LocalAppRemoteResourceRequestHandler';
import type {LocalAppRuntimePlan} from '@electron/main/LocalAppRuntimePlans';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@electron/common/Logger', () => ({createChildLogger: () => ({warn: vi.fn()})}));
vi.mock('@electron/common/Constants', () => ({
	DESKTOP_APP_SCHEME: 'fluxer-app',
	DESKTOP_APP_HOST: 'app',
	DESKTOP_APP_ORIGIN: 'fluxer-app://app',
	DESKTOP_APP_URL: 'fluxer-app://app/',
}));
vi.mock('@electron/main/LocalAppProtocolAuthorization', () => ({
	DESKTOP_PROTOCOL_AUTHORIZATION_HEADER: 'X-Fluxer-Desktop-Protocol-Authorization',
}));
vi.mock('@electron/main/LocalAppProxyClient', () => ({emitLocalAppUploadFailure: vi.fn()}));

const wav = readFileSync(new URL('../../../fluxer_static/soundboard/1.wav', import.meta.url));
const plan: LocalAppRuntimePlan = {
	instanceKey: 'https://api.example.test/v1',
	document: {},
	selfHosted: true,
	endpoints: {
		apiEndpoint: 'https://api.example.test/v1',
		apiTransportEndpoint: null,
		apiPublicEndpoint: null,
		webAppEndpoint: 'https://chat.example.test',
		mediaEndpoint: 'https://media.example.test',
		staticCdnEndpoint: 'https://static.example.test',
		uploadRelayEndpoint: null,
		gatewayEndpoint: null,
		inviteEndpoint: null,
		giftEndpoint: null,
	},
};
function localURL(target: string): string {
	const url = new URL(`fluxer-app://app/proxy/${encodeURIComponent(plan.instanceKey)}`);
	url.searchParams.set('url', target);
	return url.toString();
}

describe('desktop soundboard audio resources', () => {
	let proxyClient: {fetch: ReturnType<typeof vi.fn>; responseBodyForMethod: ReturnType<typeof vi.fn>};
	let handler: DesktopLocalAppRemoteResourceRequestHandler;
	beforeEach(() => {
		proxyClient = {
			fetch: vi.fn(
				async ({method}) =>
					new Response(method === 'HEAD' ? null : wav, {
						headers: {'Content-Type': 'audio/wav', 'Content-Length': String(wav.length), 'Accept-Ranges': 'bytes'},
					}),
			),
			responseBodyForMethod: vi.fn(async ({method, response}) => (method === 'HEAD' ? null : response.body)),
		};
		handler = new DesktopLocalAppRemoteResourceRequestHandler({
			proxyClient: proxyClient as unknown as DesktopLocalAppProxyClient,
			runtimePlans: {planForRoute: async () => plan},
		});
	});
	it('serves WAV as audio while keeping unsupported local file extensions blocked', () => {
		expect(isServedLocalAppExtension('assets/clip.WAV')).toBe(true);
		expect(localAppContentType('assets/clip.wav')).toBe('audio/wav');
		expect(isServedLocalAppExtension('assets/clip.exe')).toBe(false);
	});
	it.each(['https://static.example.test/soundboard/1.wav', 'https://media.example.test/soundboard-sounds/123'])(
		'fetches audio from the selected instance through its resource proxy',
		async (target) => {
			const response = await handler.handle(new Request(localURL(target)), new AbortController().signal);
			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toBe('audio/wav');
			expect(Buffer.from(await response.arrayBuffer())).toEqual(wav);
			expect(proxyClient.fetch).toHaveBeenCalledWith(expect.objectContaining({targetURL: target, method: 'GET'}));
		},
	);
	it('preserves range requests and strips account and local protocol credentials from audio fetches', async () => {
		await handler.handle(
			new Request(localURL('https://static.example.test/soundboard/1.wav'), {
				headers: {
					Range: 'bytes=0-43',
					Authorization: 'account-token',
					'X-Fluxer-Desktop-Protocol-Authorization': 'local-token',
				},
			}),
			new AbortController().signal,
		);
		const {headers} = proxyClient.fetch.mock.calls[0]![0];
		expect(headers.get('Range')).toBe('bytes=0-43');
		expect(headers.has('Authorization')).toBe(false);
		expect(headers.has('X-Fluxer-Desktop-Protocol-Authorization')).toBe(false);
	});
	it('supports audio HEAD requests without a response body', async () => {
		const response = await handler.handle(
			new Request(localURL('https://static.example.test/soundboard/1.wav'), {method: 'HEAD'}),
			new AbortController().signal,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Length')).toBe(String(wav.length));
		expect(await response.text()).toBe('');
	});
	it('blocks sound URLs from origins outside the selected instance', async () => {
		const response = await handler.handle(
			new Request(localURL('https://other.example.test/soundboard/1.wav')),
			new AbortController().signal,
		);
		expect(response.status).toBe(403);
		expect(proxyClient.fetch).not.toHaveBeenCalled();
	});
});
