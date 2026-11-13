import assert from 'node:assert/strict'
import test from 'node:test'
import { expiresAtMilliseconds, sessionExpired } from './runtime.ts'

test('session expiry accepts server seconds and milliseconds', () => {
	assert.equal(expiresAtMilliseconds(2_000_000_000), 2_000_000_000_000)
	assert.equal(expiresAtMilliseconds(2_000_000_000_000), 2_000_000_000_000)
})

test('session expiry is checked against the wall clock', () => {
	assert.equal(sessionExpired({ user: { name: 'Ada', expiresAt: 100 } }, 101_000), true)
	assert.equal(sessionExpired({ user: { name: 'Ada', expiresAt: 100 } }, 99_000), false)
	assert.equal(sessionExpired({ user: null }, 200_000), false)
})
