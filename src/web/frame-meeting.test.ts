import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMeetingViewModel, meetingPreview } from './frame/meeting/viewmodel.ts'

test('meeting preview falls back to local workspace and disables hardware controls', () => {
	const model = meetingPreview()
	assert.equal(model.controlsEnabled, false)
	assert.equal(model.detail, 'Local session')
	assert.equal(model.elapsed, '0:00')
	assert.equal(model.liveDot, false)
	assert.equal(model.participants.length, 1)
	assert.equal(model.participants[0].name, 'You')
})

test('meeting view reflects live presence members, presenter name, and keeps hardware controls disabled', () => {
	const model = buildMeetingViewModel({
		presenceActive: true,
		authMode: 'demo',
		canvasName: 'System architecture',
		members: [
			{ id: 'm1', username: 'Ada', sharer: false, color: '#00a2e1', cursor: null },
			{ id: 'm2', username: 'Host', sharer: true, color: '#b23f63', cursor: null },
		],
		presenterId: 'm2',
		selfId: 'm1',
		elapsedSeconds: 65,
	})
	assert.equal(model.controlsEnabled, false)
	assert.equal(model.title, 'System architecture')
	assert.equal(model.detail, '2 online · Host presenting')
	assert.equal(model.elapsed, '1:05')
	assert.equal(model.liveDot, true)
	assert.equal(model.participants.length, 2)
	assert.equal(model.participants[0].id, 'm1')
	assert.equal(model.participants[1].id, 'm2')
})
