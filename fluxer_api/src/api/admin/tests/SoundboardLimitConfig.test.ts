// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount, setUserACLs} from '@app/api/auth/tests/AuthTestUtils';
import {getLimitConfigService} from '@app/api/middleware/ServiceSingletons';
import type {ApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import {SOUNDBOARD_UPLOAD_MAX_BYTES} from '@fluxer/constants/src/SoundboardConstants';
import {resolveLimit} from '@fluxer/limits/src/LimitResolver';
import type {LimitConfigGetResponse} from '@fluxer/schema/src/domains/admin/AdminSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import type {z} from 'zod';

type LimitResponse = z.infer<typeof LimitConfigGetResponse>;

describe('soundboard admin limits', () => {
	let harness: ApiTestHarness;
	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
	});
	afterAll(async () => {
		await harness.shutdown();
	});
	it('exposes soundboard settings and persists changes through the existing admin endpoint', async () => {
		const admin = await setUserACLs(harness, await createTestAccount(harness), [
			AdminACLs.AUTHENTICATE,
			AdminACLs.INSTANCE_LIMIT_CONFIG_VIEW,
			AdminACLs.INSTANCE_LIMIT_CONFIG_UPDATE,
		]);
		const current = await createBuilder<LimitResponse>(harness, admin.token).get('/admin/limit-config').execute();
		for (const key of ['max_guild_soundboard_sounds', 'soundboard_max_size', 'soundboard_max_duration_ms'] as const) {
			expect(current.limit_keys).toContain(key);
			expect(current.metadata[key]).toMatchObject({category: 'soundboard', scope: 'guild'});
		}
		const config = current.limit_config;
		const rule = config.rules.find((rule) => rule.id === 'default')!;
		Object.assign(rule.limits, {
			max_guild_soundboard_sounds: 32,
			soundboard_max_size: 2 * 1024 * 1024,
			soundboard_max_duration_ms: 10000,
		});
		await createBuilder(harness, admin.token).put('/admin/limit-config').body({limit_config: config}).execute();
		await getLimitConfigService().refreshCache();
		const saved = await createBuilder<LimitResponse>(harness, admin.token).get('/admin/limit-config').execute();
		expect(saved.limit_config.rules.find((rule) => rule.id === 'default')?.limits).toMatchObject(rule.limits);
		const context = {traits: new Set<string>(), guildFeatures: new Set<string>()};
		expect(
			resolveLimit(getLimitConfigService().getConfigSnapshot(), context, 'max_guild_soundboard_sounds', {
				evaluationContext: 'guild',
			}),
		).toBe(32);
		expect(
			resolveLimit(getLimitConfigService().getConfigSnapshot(), context, 'soundboard_max_size', {
				evaluationContext: 'guild',
			}),
		).toBe(2 * 1024 * 1024);
		Object.assign(rule.limits, {soundboard_max_size: SOUNDBOARD_UPLOAD_MAX_BYTES + 1});
		await createBuilder(harness, admin.token)
			.put('/admin/limit-config')
			.body({limit_config: config})
			.expect(400)
			.execute();
		Object.assign(rule.limits, {soundboard_max_size: 512 * 1024, soundboard_max_duration_ms: 0});
		await createBuilder(harness, admin.token)
			.put('/admin/limit-config')
			.body({limit_config: config})
			.expect(400)
			.execute();
	});
});
