import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDuration } from './aiAudio.ts'

test('voice durations use minutes and zero-padded seconds', () => {
	assert.equal(formatDuration(0), '0:00')
	assert.equal(formatDuration(7), '0:07')
	assert.equal(formatDuration(65), '1:05')
	assert.equal(formatDuration(-4), '0:00')
	assert.equal(formatDuration(59.9), '0:59')
})
