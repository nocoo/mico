import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchUserAvatar } from './avatar.ts'
import type { MsalLike } from './msal.ts'

function client(overrides: Partial<MsalLike> = {}): MsalLike {
	return {
		handleRedirectPromise: async () => null,
		loginRedirect: async () => {
			throw new Error('Avatar must never open login')
		},
		clearCache: async () => undefined,
		getAllAccounts: () => [{ homeAccountId: 'viewer' }],
		getActiveAccount: () => null,
		acquireTokenSilent: async () => ({ accessToken: 'test-avatar-access' }),
		...overrides,
	}
}

test('avatar uses only a silent delegated Graph token and a bounded private photo request', async (t) => {
	let scopes: string[] = []
	t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
		assert.equal(url, 'https://graph.microsoft.com/v1.0/me/photos/96x96/$value')
		assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-avatar-access')
		assert.equal(init.credentials, 'omit')
		assert.equal(init.redirect, 'error')
		assert.equal(init.cache, 'no-store')
		assert.ok(init.signal)
		return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } })
	})
	const photo = await fetchUserAvatar(
		client({
			acquireTokenSilent: async (request) => {
				scopes = request.scopes
				assert.equal(request.account.homeAccountId, 'viewer')
				return { accessToken: 'test-avatar-access' }
			},
		}),
		new AbortController().signal,
	)
	assert.deepEqual(scopes, ['User.Read'])
	assert.equal(photo?.type, 'image/jpeg')
	assert.equal(photo?.size, 3)
})

test('avatar skips missing or ambiguous accounts and never requests interactive consent', async (t) => {
	let calls = 0
	t.mock.method(globalThis, 'fetch', async () => {
		calls++
		throw new Error('Unexpected request')
	})
	for (const msal of [
		client({ getAllAccounts: () => [] }),
		client({ getAllAccounts: () => [{ homeAccountId: 'one' }, { homeAccountId: 'two' }] }),
		client({
			acquireTokenSilent: async () => {
				throw new Error('consent_required')
			},
		}),
		client({ acquireTokenSilent: async () => ({ idToken: 'not-an-access-token' }) }),
	]) {
		assert.equal(await fetchUserAvatar(msal, new AbortController().signal), null)
	}
	assert.equal(calls, 0)
})

test('avatar failures and unsupported image responses remain optional', async (t) => {
	let response = new Response('', { status: 404 })
	t.mock.method(globalThis, 'fetch', async () => response)
	for (response of [
		new Response('', { status: 404 }),
		new Response('', { status: 403 }),
		new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
		new Response('', { headers: { 'Content-Type': 'image/png' } }),
		new Response('large', {
			headers: { 'Content-Type': 'image/png', 'Content-Length': String(2 * 1024 * 1024) },
		}),
	]) {
		assert.equal(await fetchUserAvatar(client(), new AbortController().signal), null)
	}
})

test('avatar enforces the byte limit even without a content length', async (t) => {
	let cancelled = false
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(1024 * 1024 + 1))
		},
		cancel() {
			cancelled = true
		},
	})
	t.mock.method(
		globalThis,
		'fetch',
		async () => new Response(body, { headers: { 'Content-Type': 'image/png' } }),
	)
	assert.equal(await fetchUserAvatar(client(), new AbortController().signal), null)
	assert.equal(cancelled, true)
})

test('avatar cancellation before and during token acquisition prevents Graph access', async (t) => {
	let calls = 0
	t.mock.method(globalThis, 'fetch', async () => {
		calls++
		throw new Error('Unexpected request')
	})
	const controller = new AbortController()
	controller.abort()
	assert.equal(await fetchUserAvatar(client(), controller.signal), null)
	const pendingController = new AbortController()
	const msal = client({
		acquireTokenSilent: async () => {
			pendingController.abort()
			return { accessToken: 'test-avatar-access' }
		},
	})
	assert.equal(await fetchUserAvatar(msal, pendingController.signal), null)
	assert.equal(calls, 0)
})
