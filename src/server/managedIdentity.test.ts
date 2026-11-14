import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMagpieModel } from './ai.ts'
import {
	createBearerFetch,
	createManagedIdentityAuth,
	createRedirectSafeFetch,
} from './managedIdentity.ts'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'
const ENDPOINT = 'https://fixture.services.ai.azure.com/openai/v1/chat/completions'

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

test('managed fetch replaces credentials, preserves request fields and refuses redirects', async (t) => {
	let requests = 0
	t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
		requests++
		const headers = new Headers(init.headers)
		assert.equal(headers.get('Authorization'), 'Bearer fixture-token')
		assert.equal(headers.get('api-key'), null)
		assert.equal(headers.get('Content-Type'), 'application/json')
		assert.equal(init.body, '{}')
		assert.equal(init.redirect, 'manual')
		return new Response('redirect', {
			status: 302,
			headers: { Location: 'https://untrusted.example' },
		})
	})
	const send = createBearerFetch(async () => 'fixture-token')
	await assert.rejects(
		send(ENDPOINT, {
			method: 'POST',
			body: '{}',
			headers: {
				Authorization: 'Bearer stale',
				'api-key': 'stale-key',
				'Content-Type': 'application/json',
			},
		}),
		/redirected/,
	)
	assert.equal(requests, 1)
})

test('cancelled managed requests never send provider traffic', async (t) => {
	let requests = 0
	let credentials = 0
	t.mock.method(globalThis, 'fetch', async () => {
		requests++
		return new Response()
	})
	const aborted = new AbortController()
	aborted.abort()
	await assert.rejects(
		createBearerFetch(async () => {
			credentials++
			return 'fixture'
		})(ENDPOINT, { signal: aborted.signal }),
		{ name: 'AbortError' },
	)
	assert.equal(credentials, 0)
	const pending = new AbortController()
	await assert.rejects(
		createBearerFetch(async () => {
			pending.abort()
			return 'fixture'
		})(ENDPOINT, { signal: pending.signal }),
		{ name: 'AbortError' },
	)
	assert.equal(requests, 0)
})

test('managed model creation cannot silently omit its token provider', () => {
	assert.throws(
		() =>
			createMagpieModel({
				baseURL: ENDPOINT,
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
