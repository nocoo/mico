import assert from 'node:assert/strict'
import test from 'node:test'
import { whiteboardDestination } from './client.ts'

test('sign-in return preserves shared join parameters without accepting redirects or session tokens', () => {
	assert.equal(
		whiteboardDestination(
			'?whiteboardid=abc&username=Jason%20Huang&sharer=true&returnTo=https://evil.test&whiteboardSession=secret',
		),
		'/?whiteboardid=abc&username=Jason+Huang&sharer=true',
	)
	assert.equal(whiteboardDestination('?whiteboards=1'), '/?whiteboards=1')
	assert.equal(whiteboardDestination('?returnTo=https://evil.test'), undefined)
})
