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
