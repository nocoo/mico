import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadRuntimeConfig, publicRuntimeContract } from '../shared/runtime.ts'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const CLIENT_ID = '22222222-2222-2222-2222-222222222222'
const ALLOWED_OID = '33333333-3333-3333-3333-333333333333'

test('runtime auth and AI controls are independent of deployment runtime', () => {
	const none = loadRuntimeConfig({ MICO_RUNTIME: 'deploy', MICO_AUTH_MODE: 'none' })
	assert.equal(none.mode, 'deploy')
	assert.deepEqual(none.auth, { mode: 'none' })
	assert.equal(none.aiEnabled, true)
	assert.equal(none.ephemeral, false)
	assert.deepEqual(publicRuntimeContract(none), {
		auth: { mode: 'none' },
		aiEnabled: true,
		mossEnabled: true,
		ephemeral: false,
	})

	const hosted = loadRuntimeConfig({
		MICO_AUTH_MODE: 'entra',
		MICO_PUBLIC_ORIGIN: 'https://mico.test',
		MICO_AUTH_TENANT_ID: TENANT_ID,
		MICO_AUTH_CLIENT_ID: CLIENT_ID,
		MICO_AUTH_ALLOWED_OBJECT_IDS: ALLOWED_OID,
		MICO_AI_ENABLED: 'false',
		MICO_EPHEMERAL: 'true',
	})
	assert.equal(hosted.aiEnabled, false)
	assert.equal(hosted.ephemeral, true)
	assert.deepEqual(hosted.allowedObjectIds, new Set([ALLOWED_OID]))
	assert.equal(hosted.auth.redirectUri, 'https://mico.test/auth/callback')
})

test('MOSS is enabled by default and always disabled with AI', () => {
	assert.equal(loadRuntimeConfig({ MICO_AI_ENABLED: 'true' }).mossEnabled, true)
	assert.equal(
		loadRuntimeConfig({ MICO_AI_ENABLED: 'true', MICO_MOSS_ENABLED: 'false' }).mossEnabled,
		false,
	)
	assert.equal(
		loadRuntimeConfig({ MICO_AI_ENABLED: 'false', MICO_MOSS_ENABLED: 'true' }).mossEnabled,
		false,
	)
	assert.throws(
		() => loadRuntimeConfig({ MICO_MOSS_ENABLED: 'sometimes' }),
		/MICO_MOSS_ENABLED must be true or false/,
	)
})

test('hosted auth configuration fails closed on incomplete or unsafe values', () => {
	assert.throws(
		() =>
			loadRuntimeConfig({
				MICO_AUTH_MODE: 'entra',
				MICO_PUBLIC_ORIGIN: 'http://mico.test',
				MICO_AUTH_TENANT_ID: TENANT_ID,
				MICO_AUTH_CLIENT_ID: CLIENT_ID,
				MICO_AUTH_ALLOWED_OBJECT_IDS: ALLOWED_OID,
			}),
		/HTTPS/,
	)
	assert.throws(
		() =>
			loadRuntimeConfig({
				MICO_AUTH_MODE: 'entra',
				MICO_PUBLIC_ORIGIN: 'https://mico.test',
				MICO_AUTH_TENANT_ID: 'common',
				MICO_AUTH_CLIENT_ID: CLIENT_ID,
				MICO_AUTH_ALLOWED_OBJECT_IDS: ALLOWED_OID,
			}),
		/MICO_AUTH_TENANT_ID must be a GUID/,
	)
	assert.throws(
		() =>
			loadRuntimeConfig({
				MICO_AUTH_MODE: 'entra',
				MICO_PUBLIC_ORIGIN: 'https://mico.test',
				MICO_AUTH_TENANT_ID: TENANT_ID,
				MICO_AUTH_CLIENT_ID: 'organizations',
				MICO_AUTH_ALLOWED_OBJECT_IDS: ALLOWED_OID,
			}),
		/MICO_AUTH_CLIENT_ID must be a GUID/,
	)
	for (const allowlist of [
		'',
		`${ALLOWED_OID},`,
		`,${ALLOWED_OID}`,
		`${ALLOWED_OID},,${ALLOWED_OID}`,
	]) {
		assert.throws(() =>
			loadRuntimeConfig({
				MICO_AUTH_MODE: 'entra',
				MICO_PUBLIC_ORIGIN: 'https://mico.test',
				MICO_AUTH_TENANT_ID: TENANT_ID,
				MICO_AUTH_CLIENT_ID: CLIENT_ID,
				MICO_AUTH_ALLOWED_OBJECT_IDS: allowlist,
			}),
		)
	}
	assert.throws(
		() => loadRuntimeConfig({ MICO_AI_ENABLED: 'sometimes' }),
		/MICO_AI_ENABLED must be true or false/,
	)
})
