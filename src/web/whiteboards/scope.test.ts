import assert from 'node:assert/strict'
import { test } from 'node:test'
import { meetingAssetUrl, meetingIdFromSearch, withMeetingScope } from './scope.ts'

test('meeting id parsing trims, bounds and accepts unicode search strings', () => {
	assert.equal(meetingIdFromSearch('?meetingid=%E7%89%A9%E7%90%86%E8%AF%BE'), '物理课')
	assert.equal(meetingIdFromSearch('?meetingid=room-1&username=Host'), 'room-1')
	assert.equal(meetingIdFromSearch('?meetingid=%20%20alpha%20'), 'alpha')
	assert.equal(meetingIdFromSearch('?meetingid='), null)
	assert.equal(meetingIdFromSearch('?username=Host'), null)
	assert.equal(meetingIdFromSearch(''), null)
	assert.equal(meetingIdFromSearch(`?meetingid=${'a'.repeat(300)}`), 'a'.repeat(256))
})

test('meeting id lookup stays case-insensitive like the server', () => {
	assert.equal(meetingIdFromSearch('?meetingID=Room-1'), 'Room-1')
	assert.equal(meetingIdFromSearch('?MeetingId=Room-1&username=Host'), 'Room-1')
	assert.equal(meetingIdFromSearch('?MEETINGID=%E7%89%A9%E7%90%86%E8%AF%BE'), '物理课')
	assert.equal(meetingIdFromSearch('?meetingid=first&meetingid=second'), 'first')
	assert.equal(meetingIdFromSearch('?meetingid=&meetingid=second'), null)
	assert.equal(withMeetingScope('/api/board?meetingID=old', 'next'), '/api/board?meetingid=next')
})

test('withMeetingScope adds or replaces the meetingid query parameter', () => {
	assert.equal(
		withMeetingScope('/api/board', '物理课'),
		'/api/board?meetingid=%E7%89%A9%E7%90%86%E8%AF%BE',
	)
	assert.equal(withMeetingScope('/api/board?meetingid=old', 'new'), '/api/board?meetingid=new')
	assert.equal(
		withMeetingScope('/api/canvases?previews=0', 'room-1'),
		'/api/canvases?previews=0&meetingid=room-1',
	)
	assert.equal(
		withMeetingScope('/api/canvases?previews=0&meetingid=old', 'room-1'),
		'/api/canvases?previews=0&meetingid=room-1',
	)
	assert.equal(withMeetingScope('/api/board', null), '/api/board')
	assert.equal(withMeetingScope('/api/board', undefined), '/api/board')
	assert.equal(
		withMeetingScope('/api/board?meetingid=stable', 'stable'),
		'/api/board?meetingid=stable',
	)
})

test('meetingAssetUrl builds a scoped, encoded image asset path', () => {
	assert.equal(
		meetingAssetUrl('asset id/1', '物理课'),
		'/api/images/asset%20id%2F1?meetingid=%E7%89%A9%E7%90%86%E8%AF%BE',
	)
	assert.equal(meetingAssetUrl('asset-1', null), '/api/images/asset-1')
})
