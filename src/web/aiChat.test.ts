import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDuration, mockReply, normalizePrompt } from './aiChat.ts'

test('empty prompts are rejected after trimming', () => {
	assert.equal(normalizePrompt(''), null)
	assert.equal(normalizePrompt('   \n '), null)
	assert.equal(normalizePrompt('  Draw a login flow  '), 'Draw a login flow')
})

test('the preview reply keeps the prompt and names the preview limit', () => {
	const reply = mockReply('  Draw a login flow  ')
	assert.match(reply, /“Draw a login flow”/)
	assert.match(reply, /interface preview/)
	assert.equal(mockReply('   '), mockReply(''))
})

test('long prompts are shortened to keep the bubble readable', () => {
	const prompt = 'a'.repeat(120)
	const reply = mockReply(prompt)
	assert.match(reply, /^Got it — “a{69}…”/)
	assert.ok(!reply.includes('a'.repeat(70)))
})

test('voice durations use minutes and zero-padded seconds', () => {
	assert.equal(formatDuration(0), '0:00')
	assert.equal(formatDuration(7), '0:07')
	assert.equal(formatDuration(65), '1:05')
	assert.equal(formatDuration(-4), '0:00')
	assert.equal(formatDuration(59.9), '0:59')
})
