import assert from 'node:assert/strict'
import { test } from 'node:test'
import { azureOrigin, azureTarget, containerApp } from './azure.ts'

const env = {
	MICO_AZ_SUBSCRIPTION_ID: '11111111-1111-4111-8111-111111111111',
	MICO_AZ_TENANT_ID: '22222222-2222-4222-8222-222222222222',
	MICO_AZ_RESOURCE_GROUP: 'preview-fixture',
	MICO_AZ_LOCATION: 'westus2',
	MICO_AZ_REGISTRY: 'previewfixtureacr',
	MICO_AZ_IDENTITY: 'preview-identity',
	MICO_AZ_ENVIRONMENT: 'preview-environment',
	MICO_AZ_APP: 'preview-app',
	MICO_AUTH_MODE: 'entra',
	MICO_AUTH_TENANT_ID: '33333333-3333-4333-8333-333333333333',
	MICO_AUTH_CLIENT_ID: '44444444-4444-4444-8444-444444444444',
	MICO_AUTH_ALLOWED_OBJECT_IDS: '55555555-5555-4555-8555-555555555555',
}

const input = {
	environmentId: '/environment/fixture',
	identityId: '/identity/fixture',
	registryServer: 'previewfixtureacr.azurecr.io',
	digest: `sha256:${'a'.repeat(64)}`,
	origin: 'https://preview-app.example.westus2.azurecontainerapps.io',
}

test('Azure target keeps login tenant independent from resource tenant', () => {
	const target = azureTarget(env)
	assert.equal(target.tenantId, env.MICO_AZ_TENANT_ID)
	assert.equal(target.authTenantId, env.MICO_AUTH_TENANT_ID)
	assert.notEqual(target.tenantId, target.authTenantId)
})

test('Azure target requires explicit resource settings and auth choice', () => {
	for (const key of Object.keys(env)) {
		assert.throws(() => azureTarget({ ...env, [key]: '' }), /Missing|Set MICO_AUTH_MODE/)
	}
	assert.throws(() => azureTarget({ ...env, MICO_AZ_APP: 'bad;name' }), /MICO_AZ_APP/)
	assert.throws(() => azureTarget({ ...env, MICO_AUTH_MODE: 'unknown' }), /MICO_AUTH_MODE/)
	assert.throws(
		() => azureTarget({ ...env, MICO_AUTH_ALLOWED_OBJECT_IDS: 'all' }),
		/MICO_AUTH_ALLOWED_OBJECT_IDS/,
	)
	assert.throws(
		() =>
			azureTarget({ ...env, MICO_AUTH_ALLOWED_OBJECT_IDS: `${env.MICO_AUTH_ALLOWED_OBJECT_IDS},` }),
		/MICO_AUTH_ALLOWED_OBJECT_IDS/,
	)
})

test('Azure target allows explicitly unauthenticated deployments without identity config', () => {
	const target = azureTarget({
		...env,
		MICO_AUTH_MODE: 'none',
		MICO_AUTH_TENANT_ID: '',
		MICO_AUTH_CLIENT_ID: '',
		MICO_AUTH_ALLOWED_OBJECT_IDS: '',
	})
	assert.equal(target.authMode, 'none')
	assert.equal(target.authTenantId, undefined)
	const app = containerApp(target, input)
	const settings = Object.fromEntries(
		app.properties.template.containers[0].env.map(({ name, value }) => [name, value]),
	)
	assert.equal(settings.MICO_AUTH_MODE, 'none')
	assert.equal(settings.MICO_AUTH_CLIENT_ID, undefined)
})

test('Azure template pins digest, uses UAMI, disables AI and marks ephemeral storage', () => {
	const app = containerApp(azureTarget(env), input)
	const web = app.properties.template.containers[0]
	const settings = Object.fromEntries(web.env.map(({ name, value }) => [name, value]))
	assert.equal(web.image, `${input.registryServer}/mico@${input.digest}`)
	assert.deepEqual(app.properties.template.scale, { minReplicas: 1, maxReplicas: 1 })
	assert.equal(app.properties.configuration.activeRevisionsMode, 'Single')
	assert.equal(app.properties.configuration.ingress.allowInsecure, false)
	assert.equal(app.properties.configuration.registries[0].identity, input.identityId)
	assert.equal(settings.MICO_AUTH_TENANT_ID, env.MICO_AUTH_TENANT_ID)
	assert.equal(settings.MICO_AI_ENABLED, 'false')
	assert.equal(settings.MICO_EPHEMERAL, 'true')
	assert.equal(settings.MICO_DB_PATH, '/tmp/mico/board.sqlite')
	assert.equal(settings.MICO_PUBLIC_ORIGIN, input.origin)
	assert.equal(settings.MAGPIE_API_KEY, undefined)
	assert.equal(settings.MICO_AZ_SUBSCRIPTION_ID, undefined)
	assert.equal(web.probes.length, 3)
	assert.ok(web.probes.every((probe) => probe.httpGet.path === '/api/live'))
	assert.throws(() => containerApp(azureTarget(env), { ...input, digest: 'latest' }), /digest/)
})

test('Azure origin derives only from the selected app and actual environment domain', () => {
	assert.equal(azureOrigin(azureTarget(env), 'example.westus2.azurecontainerapps.io'), input.origin)
	for (const domain of [
		'evil.example',
		'x.azurecontainerapps.io/evil',
		'x.azurecontainerapps.io@evil.example',
	]) {
		assert.throws(() => azureOrigin(azureTarget(env), domain), /domain/)
	}
})
