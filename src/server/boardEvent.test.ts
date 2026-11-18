import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ServerEvent } from '../shared/types.ts'
import { boardEvent } from './boardEvent.ts'

const source = {
	canvasId: 'canvas-1',
	canvas: {
		id: 'canvas-1',
		name: 'My canvas',
		revision: 4,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-02T00:00:00.000Z',
	},
	board: { revision: 4, shapes: [] },
}

test('boardEvent projects an apply result onto the wire contract', () => {
	assert.deepEqual(boardEvent(source), {
		type: 'board',
		canvasId: 'canvas-1',
		canvas: source.canvas,
		board: source.board,
	})
})

test('boardEvent satisfies the shared board server event', () => {
	const event: ServerEvent = boardEvent(source)
	assert.equal(event.type, 'board')
	if (event.type !== 'board') throw new Error('unreachable')
	assert.equal(event.canvasId, 'canvas-1')
	assert.equal(event.board.revision, 4)
})
