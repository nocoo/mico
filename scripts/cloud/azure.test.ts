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
	assert.deepEqual(app.properties.template.scale, { minReplicas: 0, maxReplicas: 1 })
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

test('Azure managed AI explicitly forwards model settings without keys or MOSS', () => {
	const configured = {
		...env,
		MICO_AI_ENABLED: 'true',
		MICO_AI_AUTH_MODE: 'managed-identity',
		MICO_MOSS_ENABLED: 'false',
		AZURE_CLIENT_ID: '66666666-6666-4666-8666-666666666666',
		MAGPIE_BASE_URL: 'https://ai-fixture.services.ai.azure.com/openai/v1',
		MAGPIE_MODEL: 'chat-fixture',
		AZURE_MAI_HOST: 'ai-fixture.services.ai.azure.com',
		AZURE_OPENAI_DEPLOYMENT: 'speech-fixture',
		MAGPIE_LECTURE_REASONING: 'low',
		MAGPIE_API_KEY: 'never-forward',
		AZURE_OPENAI_API_KEY: 'never-forward',
	}
	const target = azureTarget(configured)
	const settings = Object.fromEntries(
		containerApp(target, input).properties.template.containers[0].env.map(({ name, value }) => [
			name,
			value,
		]),
	)
	assert.equal(settings.MICO_AI_ENABLED, 'true')
	assert.equal(settings.MICO_AI_AUTH_MODE, 'managed-identity')
	assert.equal(settings.MICO_MOSS_ENABLED, 'false')
	assert.equal(settings.MAGPIE_MODEL, 'chat-fixture')
	assert.equal(settings.MAGPIE_LECTURE_REASONING, 'low')
	assert.equal(settings.MAGPIE_CHAT_REASONING, 'low')
	assert.equal(settings.AZURE_OPENAI_DEPLOYMENT, 'speech-fixture')
	assert.equal(settings.AZURE_CLIENT_ID, configured.AZURE_CLIENT_ID)
	assert.equal(settings.MAGPIE_API_KEY, undefined)
	assert.equal(settings.AZURE_OPENAI_API_KEY, undefined)
	assert.ok(!JSON.stringify(target).includes('never-forward'))
	const withCustomChatReasoning = azureTarget({
		...configured,
		MAGPIE_LECTURE_REASONING: 'none',
		MAGPIE_CHAT_REASONING: 'high',
	})
	const customEnv = Object.fromEntries(
		containerApp(withCustomChatReasoning, input).properties.template.containers[0].env.map(
			({ name, value }) => [name, value],
		),
	)
	assert.equal(customEnv.MAGPIE_LECTURE_REASONING, 'none')
	assert.equal(customEnv.MAGPIE_CHAT_REASONING, 'high')
	assert.throws(
		() => azureTarget({ ...configured, MICO_AI_AUTH_MODE: 'api-key' }),
		/managed-identity/,
	)
	assert.throws(() => azureTarget({ ...configured, MICO_MOSS_ENABLED: 'true' }), /MOSS/)
	assert.throws(() => azureTarget({ ...configured, AZURE_MAI_HOST: '' }), /AZURE_MAI_HOST/)
	assert.throws(
		() => azureTarget({ ...configured, MAGPIE_BASE_URL: 'https://untrusted.example' }),
		/Azure AI HTTPS/,
	)
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

test('Azure target supports demo mode and AI IP allowlist', () => {
	const demoEnv = {
		...env,
		MICO_AUTH_MODE: 'demo',
		MICO_AUTH_TENANT_ID: '',
		MICO_AUTH_CLIENT_ID: '',
		MICO_AUTH_ALLOWED_OBJECT_IDS: '',
		MICO_AI_IP_ALLOWLIST: '167.220.0.0/16',
	}
	const target = azureTarget(demoEnv)
	assert.equal(target.authMode, 'demo')
	assert.equal(target.aiIpAllowlist, '167.220.0.0/16')
	const settings = Object.fromEntries(
		containerApp(target, input).properties.template.containers[0].env.map(({ name, value }) => [
			name,
			value,
		]),
	)
	assert.equal(settings.MICO_AUTH_MODE, 'demo')
	assert.equal(settings.MICO_AI_IP_ALLOWLIST, '167.220.0.0/16')
	assert.equal(settings.MICO_AUTH_TENANT_ID, undefined)
	assert.throws(
		() => azureTarget({ ...demoEnv, MICO_AI_IP_ALLOWLIST: 'invalid-cidr' }),
		/Invalid IP/,
	)
})

test('Azure target configures persistent PostgreSQL + Blob storage with managed identity', () => {
	const persistentEnv = {
		...env,
		MICO_AUTH_MODE: 'demo',
		MICO_STORAGE_BACKEND: 'azure',
		MICO_PG_HOST: 'mico-pg-example.postgres.database.azure.com',
		MICO_PG_DATABASE: 'mico',
		MICO_PG_USER: 'mico-uami',
		MICO_AZURE_STORAGE_ACCOUNT: 'micoblobexample',
		MICO_AZURE_STORAGE_CONTAINER: 'mico-assets',
		AZURE_CLIENT_ID: '33333333-3333-4333-8333-333333333333',
	}
	const target = azureTarget(persistentEnv)
	const settings = Object.fromEntries(
		containerApp(target, input).properties.template.containers[0].env.map(({ name, value }) => [
			name,
			value,
		]),
	)
	assert.equal(settings.MICO_EPHEMERAL, 'false')
	assert.equal(settings.MICO_STORAGE_BACKEND, 'azure')
	assert.equal(settings.MICO_PG_AUTH_MODE, 'managed-identity')
	assert.equal(settings.MICO_PG_HOST, 'mico-pg-example.postgres.database.azure.com')
	assert.equal(settings.MICO_PG_DATABASE, 'mico')
	assert.equal(settings.MICO_PG_USER, 'mico-uami')
	assert.equal(settings.MICO_AZURE_STORAGE_ACCOUNT, 'micoblobexample')
	assert.equal(settings.MICO_AZURE_STORAGE_CONTAINER, 'mico-assets')
})
