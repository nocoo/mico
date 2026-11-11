import assert from 'node:assert/strict'
import { test } from 'node:test'
import { meetingPreview } from './frame/meeting/viewmodel.ts'

test('meeting preview is explicitly disconnected and disables real meeting controls', () => {
	const model = meetingPreview()
	assert.equal(model.controlsEnabled, false)
	assert.match(model.detail, /no meeting connected/i)
	assert.equal(model.elapsed, '0:00')
	assert.equal(model.participants.length, 5)
	assert.equal(new Set(model.participants.map((participant) => participant.name)).size, 5)
})
