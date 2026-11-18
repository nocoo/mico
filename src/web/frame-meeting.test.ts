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

test('live avatars follow presenter identity, not stale sharer flags or duplicate names', () => {
	const members = [
		{ id: 'a', username: 'Ada', sharer: true, color: '#6844bd', cursor: null },
		{ id: 'b', username: 'Ada', sharer: false, color: '#006f91', cursor: null },
	]
	const model = meetingPreview({ members, presenterId: 'b', selfId: 'a' })
	assert.deepEqual(
		model.participants.map(({ id, presenter, self }) => ({ id, presenter, self })),
		[
			{ id: 'a', presenter: false, self: true },
			{ id: 'b', presenter: true, self: false },
		],
	)
	assert.equal(model.controlsEnabled, false)
	assert.equal(
		meetingPreview({ members, presenterId: null, selfId: null }).participants.some(
			(participant) => participant.presenter,
		),
		false,
	)
	assert.deepEqual(
		meetingPreview({ members: [], presenterId: null, selfId: null }).participants,
		[],
	)
})
