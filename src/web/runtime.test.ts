import assert from 'node:assert/strict'
import test from 'node:test'
import { expiresAtMilliseconds, parseRuntimeConfig, sessionExpired } from './runtime.ts'

test('runtime contract requires moss capability', () => {
	const valid = {
		auth: { mode: 'none' as const },
		aiEnabled: true,
		ephemeral: false,
		mossEnabled: false,
	}
	assert.deepEqual(parseRuntimeConfig(valid), valid)
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
