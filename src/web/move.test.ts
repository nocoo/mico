import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Board, CanvasShape } from '../shared/types.ts'
import { canRebaseMove, canRebaseMoveGroup } from './move.ts'

const shape: CanvasShape = {
	id: 'node',
	type: 'rectangle',
	x: 100,
	y: 80,
	w: 120,
	h: 60,
	color: '#5b5fc7',
}

const board = (shapes: Board['shapes']): Board => ({ revision: 1, shapes })

test('a move rebases only while its target remains unchanged', () => {
	assert.equal(canRebaseMove(board([{ ...shape }]), shape), true)
	assert.equal(canRebaseMove(board([{ ...shape, color: '#000000' }]), shape), false)
	assert.equal(canRebaseMove(board([{ ...shape, w: 121 }]), shape), false)
	assert.equal(canRebaseMove(board([{ ...shape, text: 'replacement' }]), shape), false)
	assert.equal(canRebaseMove(board([{ ...shape, x: 101 }]), shape), false)
	assert.equal(canRebaseMove(board([{ ...shape, y: 81 }]), shape), false)
	assert.equal(canRebaseMove(board([{ ...shape, type: 'ellipse' }]), shape), false)
	assert.equal(canRebaseMove(board([]), shape), false)
})

test('a frame move rebases only while its member set is unchanged', () => {
	const frame: CanvasShape = {
		id: 'frame',
		type: 'frame',
		x: 0,
		y: 0,
		w: 400,
		h: 300,
		color: '#5b5fc7',
		title: 'Frame',
	}
	const member: CanvasShape = { ...shape, frameId: 'frame' }
	const other: CanvasShape = { ...shape, id: 'other' }
	const group = [frame, member]
	assert.equal(canRebaseMoveGroup(board([{ ...frame }, { ...member }, { ...other }]), group), true)
	assert.equal(
		canRebaseMoveGroup(board([{ ...frame }, { ...member }, { ...other, frameId: 'frame' }]), group),
		false,
	)
	assert.equal(
		canRebaseMoveGroup(
			board([{ ...frame }, { ...member, frameId: undefined }, { ...other }]),
			group,
		),
		false,
	)
	assert.equal(
		canRebaseMoveGroup(board([{ ...frame, x: 4 }, { ...member }, { ...other }]), group),
		false,
	)
})

test('a non-frame group rebases with the previous per-shape check', () => {
	const second: CanvasShape = { ...shape, id: 'second' }
	const group = [shape, second]
	assert.equal(canRebaseMoveGroup(board([{ ...shape }, { ...second }]), group), true)
	assert.equal(canRebaseMoveGroup(board([{ ...shape }, { ...second, y: 4 }]), group), false)
})
