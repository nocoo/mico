import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
	expiresAtMilliseconds,
	fetchRuntime,
	fetchSession,
	parseRuntimeConfig,
	sessionExpired,
} from './runtime.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
	if (originalFetch === undefined) delete (globalThis as { fetch?: typeof fetch }).fetch
	else Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch })
})

test('runtime contract requires moss capability', () => {
	const valid = {
		auth: { mode: 'none' as const },
		aiEnabled: true,
		aiSettingsVisible: true,
		ephemeral: false,
		mossEnabled: false,
	}
	assert.deepEqual(parseRuntimeConfig(valid), valid)
	assert.deepEqual(parseRuntimeConfig({ ...valid, auth: { mode: 'demo' as const } }), {
		...valid,
		auth: { mode: 'demo' as const },
	})
	assert.throws(() => parseRuntimeConfig({ ...valid, aiSettingsVisible: undefined }), /invalid/i)
	assert.throws(() => parseRuntimeConfig({ ...valid, aiSettingsVisible: 'false' }), /invalid/i)
	assert.throws(() => parseRuntimeConfig({ ...valid, mossEnabled: undefined }), /invalid/i)
	assert.throws(() => parseRuntimeConfig({ ...valid, mossEnabled: 'false' }), /invalid/i)
})

test('session expiry uses server milliseconds consistently', () => {
	assert.equal(expiresAtMilliseconds(2_000_000_000), 2_000_000_000)
	assert.equal(expiresAtMilliseconds(2_000_000_000_000), 2_000_000_000_000)
})

test('session expiry is checked against the wall clock', () => {
	assert.equal(sessionExpired({ user: { name: 'Ada', expiresAt: 100 } }, 101), true)
	assert.equal(sessionExpired({ user: { name: 'Ada', expiresAt: 100 } }, 99), false)
	assert.equal(sessionExpired({ user: null }, 200), false)
})

test('parseRuntimeConfig validates structure and fetchRuntime/fetchSession handle responses', async () => {
	assert.throws(() => parseRuntimeConfig(null), /invalid/i)
	assert.throws(() => parseRuntimeConfig({}), /invalid/i)
	assert.throws(() => parseRuntimeConfig({ auth: { mode: 'other' } }), /invalid/i)

	const payload = {
		auth: { mode: 'none' },
		aiEnabled: true,
		aiSettingsVisible: true,
		ephemeral: false,
		mossEnabled: true,
	}
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async (url: string) => {
			if (url === '/api/runtime') {
				return new Response(JSON.stringify(payload), { status: 200 })
			}
			return new Response(JSON.stringify({ user: { name: 'Ada', expiresAt: 999 } }), {
				status: 200,
			})
		},
	})
	assert.deepEqual(await fetchRuntime(), payload)
	assert.deepEqual(await fetchSession(), { user: { name: 'Ada', expiresAt: 999 } })

	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async (url: string) =>
			new Response(null, { status: url === '/api/auth/session' ? 401 : 503 }),
	})
	assert.deepEqual(await fetchSession(), { user: null })
	await assert.rejects(fetchRuntime(), /could not be loaded/i)

	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async () => new Response(null, { status: 500 }),
	})
	await assert.rejects(fetchSession(), /could not be verified/i)
})
