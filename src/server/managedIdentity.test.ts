import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMagpieModel } from './ai.ts'
import { createManagedIdentityAuth, createRedirectSafeFetch } from './managedIdentity.ts'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'
const BASE = 'https://fixture.services.ai.azure.com/openai/v1'
const ENDPOINT = `${BASE}/responses`
const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'test' }] }]

function managedModel(bearer: () => Promise<string>) {
	const model = createMagpieModel(
		{ baseURL: BASE, model: 'gpt-6.1-sol', apiKey: 'must-not-use', authMode: 'managed-identity' },
		bearer,
	)
	assert.ok(typeof model === 'object' && model.specificationVersion === 'v4')
	assert.equal(model.provider, 'azure.responses')
	return model
}

test('SDK bearer providers share the Foundry audience cache and renew expired tokens', async (t) => {
	let now = Date.now()
	t.mock.method(Date, 'now', () => now)
	const scopes: Array<string | string[]> = []
	const auth = createManagedIdentityAuth(CLIENT_ID, {
		async getToken(scope) {
			scopes.push(scope)
			return { token: `fixture-${scopes.length}`, expiresOnTimestamp: now + 3_600_000 }
		},
	})
	assert.equal(await auth.chatBearer(), 'fixture-1')
	assert.equal(await auth.chatBearer(), 'fixture-1')
	assert.equal(await auth.maiBearer(), 'fixture-1')
	assert.equal(await auth.maiBearer(), 'fixture-1')
	assert.equal(scopes.length, 1)
	now += 3_601_000
	assert.equal(await auth.chatBearer(), 'fixture-2')
	assert.deepEqual(scopes, [['https://ai.azure.com/.default'], ['https://ai.azure.com/.default']])
})

test('Azure Responses uses the token provider without API keys and refuses redirects', async (t) => {
	let requests = 0
	t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
		requests++
		assert.equal(String(url), ENDPOINT)
		const headers = new Headers(init.headers)
		assert.equal(headers.get('Authorization'), 'Bearer fixture-token')
		assert.equal(headers.get('api-key'), null)
		assert.equal(headers.get('Content-Type'), 'application/json')
		assert.equal(JSON.parse(String(init.body)).model, 'gpt-6.1-sol')
		assert.equal(init.redirect, 'manual')
		return new Response('redirect', {
			status: 302,
			headers: { Location: 'https://untrusted.example' },
		})
	})
	await assert.rejects(
		async () => managedModel(async () => 'fixture-token').doStream({ prompt }),
		/redirected/,
	)
	assert.equal(requests, 1)
})

test('cancelled managed Responses requests never send provider traffic', async (t) => {
	let requests = 0
	t.mock.method(globalThis, 'fetch', async () => {
		requests++
		return new Response()
	})
	const aborted = new AbortController()
	aborted.abort()
	await assert.rejects(createRedirectSafeFetch()(ENDPOINT, { signal: aborted.signal }), {
		name: 'AbortError',
	})
	const pending = new AbortController()
	const model = managedModel(async () => {
		pending.abort()
		return 'fixture'
	})
	await assert.rejects(async () => model.doStream({ prompt, abortSignal: pending.signal }), {
		name: 'AbortError',
	})
	assert.equal(requests, 0)
})

test('managed model creation cannot silently omit its token provider', () => {
	assert.throws(
		() =>
			createMagpieModel({
				baseURL: BASE,
				model: 'fixture',
				apiKey: '',
				authMode: 'managed-identity',
			}),
		/token provider is required/,
	)
})

test('key-authenticated fetch also refuses a credential-bearing redirect', async (t) => {
	t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
		assert.equal(init.redirect, 'manual')
		return new Response(null, { status: 307, headers: { Location: 'https://untrusted.example' } })
	})
	await assert.rejects(createRedirectSafeFetch()(ENDPOINT), /redirected/)
})
