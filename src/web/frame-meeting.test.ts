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

test('editor avatars follow current-canvas participant grants, with presenter priority', () => {
	const members = [
		{
			id: 'host',
			participantId: 'host-profile',
			username: 'Host',
			sharer: true,
			color: '#6844bd',
			cursor: null,
		},
		{
			id: 'guest',
			participantId: 'guest-profile',
			username: 'Guest',
			sharer: false,
			color: '#006f91',
			cursor: null,
		},
		{
			id: 'other',
			participantId: 'other-profile',
			username: 'Guest',
			sharer: false,
			color: '#006f91',
			cursor: null,
		},
		{
			id: 'second-tab',
			participantId: 'guest-profile',
			username: 'Guest renamed',
			sharer: false,
			color: '#006f91',
			cursor: null,
		},
	]
	const presence = {
		members,
		presenterId: 'host',
		selfId: 'guest',
		canvasEditorIds: ['host-profile', 'guest-profile'],
	}
	const editors = (model: ReturnType<typeof meetingPreview>) =>
		model.participants
			.filter((participant) => participant.editor)
			.map((participant) => participant.id)
	assert.deepEqual(editors(meetingPreview(presence)), ['guest', 'second-tab'])
	assert.deepEqual(editors(meetingPreview({ ...presence, canvasEditorIds: [] })), [])
	const transferred = meetingPreview({ ...presence, presenterId: 'guest' })
	assert.deepEqual(editors(transferred), ['host', 'second-tab'])
	assert.equal(
		transferred.participants.find((participant) => participant.id === 'guest')?.presenter,
		true,
	)
	assert.deepEqual(editors(meetingPreview({ members, presenterId: null, selfId: null })), [])
})
