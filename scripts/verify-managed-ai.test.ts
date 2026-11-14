import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyManagedAi } from './verify-managed-ai.ts'

test('managed verification requires explicit paid-provider confirmation', async (t) => {
	let calls = 0
	t.mock.method(globalThis, 'fetch', async () => {
		calls++
		throw new Error('Unexpected network')
	})
	await assert.rejects(
		verifyManagedAi({ pcm: Buffer.alloc(2), confirmProviderUsage: false }),
		/confirmation/,
	)
	assert.equal(calls, 0)
})

test('managed verification rejects invalid audio before creating a daemon or using credentials', async (t) => {
	const saved = { ...process.env }
	t.after(() => {
		for (const key of ['MICO_AI_AUTH_MODE', 'MICO_AI_ENABLED', 'MICO_MOSS_ENABLED']) {
			if (saved[key] === undefined) delete process.env[key]
			else process.env[key] = saved[key]
		}
	})
	process.env.MICO_AI_AUTH_MODE = 'managed-identity'
	process.env.MICO_AI_ENABLED = 'true'
	process.env.MICO_MOSS_ENABLED = 'false'
	let calls = 0
	t.mock.method(globalThis, 'fetch', async () => {
		calls++
		throw new Error('Unexpected network')
	})
	for (const pcm of [Buffer.alloc(0), Buffer.alloc(1), Buffer.alloc(20 * 16000 * 2 + 2)]) {
		await assert.rejects(verifyManagedAi({ pcm, confirmProviderUsage: true }), /PCM16/)
	}
	assert.equal(calls, 0)
})
