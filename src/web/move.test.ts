import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Board, CanvasShape } from '../shared/types.ts'
import { canRebaseMove } from './move.ts'

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
