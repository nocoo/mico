import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasShape, Shape } from '../shared/types.ts'
import { frameContains, frameFor, membershipAfterMove, membershipFor } from './containers.ts'

const frame = (id: string, x: number, y: number, w: number, h: number): CanvasShape => ({
	id,
	type: 'frame',
	x,
	y,
	w,
	h,
	color: '#5b5fc7',
	title: id,
})

const note = (id: string, x: number, y: number, w = 100, h = 100): CanvasShape => ({
	id,
	type: 'note',
	x,
	y,
	w,
	h,
	color: '#fef3c7',
	text: id,
})

test('a frame contains a rect only when it fully covers it', () => {
	const outer = frame('outer', 0, 0, 400, 300)
	assert.equal(frameContains(outer, { x: 10, y: 10, w: 100, h: 100 }), true)
	assert.equal(frameContains(outer, { x: 0, y: 0, w: 400, h: 300 }), true)
	assert.equal(frameContains(outer, { x: 350, y: 10, w: 100, h: 100 }), false)
	assert.equal(frameContains(outer, { x: -10, y: 10, w: 100, h: 100 }), false)
	assert.equal(frameContains(outer, { x: 10, y: 10, w: 400, h: 100 }), false)
})

test('a shape joins the smallest frame that fully contains it', () => {
	const shapes: Shape[] = [
		frame('large', 0, 0, 900, 700),
		frame('small', 50, 50, 300, 200),
		note('outside', 1000, 1000),
	]
	assert.equal(membershipFor(shapes, { x: 100, y: 100, w: 100, h: 100 }), 'small')
	assert.equal(membershipFor(shapes, { x: 10, y: 10, w: 100, h: 100 }), 'large')
	assert.equal(membershipFor(shapes, { x: 1000, y: 1000, w: 50, h: 50 }), null)
})

test('partial overlap never joins a frame', () => {
	const shapes: Shape[] = [frame('frame', 0, 0, 400, 300)]
	assert.equal(membershipFor(shapes, { x: 350, y: 100, w: 100, h: 100 }), null)
	assert.equal(membershipFor(shapes, { x: -50, y: 100, w: 400, h: 100 }), null)
})

test('frames are never their own container and connectors are ignored', () => {
	const shapes: Shape[] = [
		frame('outer', 0, 0, 400, 300),
		{ id: 'edge', type: 'connector', from: 'outer', to: 'outer-2', color: '#000000' },
	]
	assert.equal(frameFor(shapes, { x: 10, y: 10, w: 50, h: 50 }, 'outer'), null)
	assert.equal(frameFor(shapes, { x: 10, y: 10, w: 50, h: 50 })?.id, 'outer')
})

test('the first frame wins when two frames share the same area', () => {
	const shapes: Shape[] = [frame('first', 0, 0, 200, 200), frame('second', 0, 0, 200, 200)]
	assert.equal(frameFor(shapes, { x: 10, y: 10, w: 20, h: 20 })?.id, 'first')
})

test('signed line geometry is normalized before containment', () => {
	const shapes: Shape[] = [frame('frame', 0, 0, 400, 300)]
	assert.equal(membershipFor(shapes, { x: 300, y: 200, w: -200, h: -60 }), 'frame')
	assert.equal(membershipFor(shapes, { x: 100, y: 100, w: 300, h: 220 }), null)
	assert.equal(membershipFor(shapes, { x: -50, y: 100, w: 100, h: 50 }), null)
	assert.equal(membershipFor(shapes, { x: 100, y: 100, w: -200, h: 0 }), null)
	assert.equal(membershipFor(shapes, { x: 100, y: 100, w: 0, h: -200 }), null)
})

test('an existing member keeps its frame while any part still overlaps', () => {
	const shapes: Shape[] = [frame('frame', 0, 0, 400, 300), frame('other', 800, 0, 400, 300)]
	assert.equal(
		membershipAfterMove(shapes, 'frame', { x: 360, y: 100, w: 100, h: 100 }, 'n'),
		'frame',
	)
	assert.equal(membershipAfterMove(shapes, 'frame', { x: 500, y: 100, w: 100, h: 100 }, 'n'), null)
	assert.equal(
		membershipAfterMove(shapes, 'frame', { x: 850, y: 50, w: 100, h: 100 }, 'n'),
		'other',
	)
})

test('a member that leaves its frame joins the frame it lands inside', () => {
	const shapes: Shape[] = [frame('alpha', 0, 0, 400, 300), frame('beta', 800, 0, 400, 300)]
	assert.equal(
		membershipAfterMove(shapes, 'alpha', { x: 900, y: 100, w: 100, h: 100 }, 'n'),
		'beta',
	)
	assert.equal(
		membershipAfterMove(shapes, undefined, { x: 900, y: 100, w: 100, h: 100 }, 'n'),
		'beta',
	)
	assert.equal(
		membershipAfterMove(shapes, undefined, { x: 500, y: 100, w: 100, h: 100 }, 'n'),
		null,
	)
})
