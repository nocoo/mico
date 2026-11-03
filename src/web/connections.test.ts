import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Board, CanvasShape, Shape } from '../shared/types.ts'
import { canRebaseConnector, findSnapTarget, trimConnectorHitSegment } from './connections.ts'

const rectangle: CanvasShape = {
	id: 'a',
	type: 'rectangle',
	x: 0,
	y: 0,
	w: 100,
	h: 100,
	color: '#5b5fc7',
}

const ellipse: CanvasShape = {
	id: 'e',
	type: 'ellipse',
	x: 0,
	y: 0,
	w: 100,
	h: 100,
	color: '#5b5fc7',
}

const line: CanvasShape = {
	id: 'l',
	type: 'line',
	x: 100,
	y: 100,
	w: -60,
	h: -30,
	color: '#5b5fc7',
}

const connector: Shape = {
	id: 'c',
	type: 'connector',
	from: 'a',
	to: 'e',
	color: '#616161',
}

test('short connector hit segments keep a selectable midpoint', () => {
	const short = trimConnectorHitSegment({ x: 100, y: 100 }, { x: 108, y: 100 }, 1)
	assert.ok(short)
	assert.equal(short.start.y, 100)
	assert.equal(short.end.y, 100)
	assert.equal(short.start.x, 102)
	assert.equal(short.end.x, 106)
	assert.equal(short.short, true)

	const degenerate = trimConnectorHitSegment({ x: 100, y: 100 }, { x: 100, y: 100 }, 1)
	assert.equal(degenerate.start.x, 96)
	assert.equal(degenerate.end.x, 104)

	const long = trimConnectorHitSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 1)
	assert.deepEqual(long, { start: { x: 24, y: 0 }, end: { x: 76, y: 0 }, short: false })
})

test('snapping picks the nearest anchor of the closest node', () => {
	const target = findSnapTarget([rectangle], { x: 52, y: 2 }, 'other', 1)
	assert.deepEqual(target, { shapeId: 'a', anchorIndex: 0, point: { x: 50, y: 0 } })
})

test('snapping stays within 24 screen pixels of the node boundary', () => {
	assert.equal(findSnapTarget([rectangle], { x: 50, y: -20 }, 'other', 1)?.shapeId, 'a')
	assert.equal(findSnapTarget([rectangle], { x: 50, y: -30 }, 'other', 1), null)
	assert.equal(findSnapTarget([rectangle], { x: 50, y: -20 }, 'other', 2), null)
	assert.equal(findSnapTarget([rectangle], { x: 50, y: -10 }, 'other', 2)?.shapeId, 'a')
})

test('snapping ignores the source shape and connectors', () => {
	assert.equal(findSnapTarget([rectangle], { x: 50, y: 50 }, 'a', 1), null)
	assert.equal(findSnapTarget([rectangle, connector], { x: 50, y: 50 }, 'other', 1)?.shapeId, 'a')
	assert.equal(findSnapTarget([connector], { x: 50, y: 50 }, 'other', 1), null)
})

test('the topmost overlapping node wins', () => {
	const top: CanvasShape = { ...rectangle, id: 'top' }
	const bottom: CanvasShape = { ...rectangle, id: 'bottom' }
	const target = findSnapTarget([bottom, top], { x: 50, y: 50 }, 'other', 1)
	assert.equal(target?.shapeId, 'top')
})

test('a node containing the pointer beats a node that is merely nearby', () => {
	const near: CanvasShape = {
		id: 'near',
		type: 'rectangle',
		x: 60,
		y: 0,
		w: 100,
		h: 100,
		color: '#000000',
	}
	const target = findSnapTarget([near, rectangle], { x: 50, y: 50 }, 'other', 1)
	assert.equal(target?.shapeId, 'a')
})

test('ellipses use their real boundary instead of their bounding box', () => {
	const segment: CanvasShape = {
		id: 'seg',
		type: 'line',
		x: 80,
		y: 0,
		w: 20,
		h: 20,
		color: '#000000',
	}
	const insideBox = findSnapTarget([ellipse], { x: 95, y: 5 }, 'other', 1)
	assert.ok(insideBox)
	assert.equal(insideBox?.shapeId, 'e')

	const closer = findSnapTarget([ellipse, segment], { x: 95, y: 5 }, 'other', 1)
	assert.equal(closer?.shapeId, 'seg')
})

test('ellipse snapping uses the real screen-space distance, not a gradient estimate', () => {
	const circle: CanvasShape = {
		id: 'circle',
		type: 'ellipse',
		x: 0,
		y: 0,
		w: 100,
		h: 100,
		color: '#123456',
	}
	assert.equal(findSnapTarget([circle], { x: 126, y: 50 }, '', 1), null)
	assert.ok(findSnapTarget([circle], { x: 123, y: 50 }, '', 1))
	assert.equal(findSnapTarget([circle], { x: 113, y: 50 }, '', 2), null)
})

test('ellipse anchors are reachable from inside the ellipse', () => {
	const target = findSnapTarget([ellipse], { x: 50, y: 50 }, 'other', 1)
	assert.equal(target?.shapeId, 'e')
	assert.ok(target)
	assert.ok(target.anchorIndex >= 0 && target.anchorIndex < 12)
	const radius = Math.hypot(target.point.x - 50, target.point.y - 50)
	assert.ok(Math.abs(radius - 50) < 1e-9)
})

test('lines snap to their nearest segment point, including signed directions', () => {
	const target = findSnapTarget([line], { x: 70, y: 85 }, 'other', 1)
	assert.deepEqual(target, { shapeId: 'l', anchorIndex: 1, point: { x: 70, y: 85 } })
	assert.equal(findSnapTarget([line], { x: 70, y: 140 }, 'other', 1), null)
})

test('degenerate geometry still snaps within the threshold', () => {
	const dot: CanvasShape = {
		id: 'dot',
		type: 'rectangle',
		x: 10,
		y: 10,
		w: 0,
		h: 0,
		color: '#000000',
	}
	const target = findSnapTarget([dot], { x: 30, y: 10 }, 'other', 1)
	assert.deepEqual(target, { shapeId: 'dot', anchorIndex: 0, point: { x: 10, y: 10 } })
	assert.equal(findSnapTarget([dot], { x: 40, y: 10 }, 'other', 1), null)

	const flatEllipse: CanvasShape = {
		id: 'flat',
		type: 'ellipse',
		x: 0,
		y: 0,
		w: 0,
		h: 100,
		color: '#000000',
	}
	const flat = findSnapTarget([flatEllipse], { x: 5, y: 50 }, 'other', 1)
	assert.equal(flat?.shapeId, 'flat')
	assert.deepEqual(flat?.point, { x: 0, y: 50 })
})

test('connectors can only be rebased while they stay identical', () => {
	const original = {
		id: 'c',
		type: 'connector',
		from: 'a',
		to: 'e',
		color: '#616161',
		fromAnchor: 2,
		toAnchor: 5,
	} as const
	const board: Board = { revision: 3, shapes: [{ ...original }] }
	assert.equal(canRebaseConnector(board, original), true)

	assert.equal(canRebaseConnector(board, { ...original, color: '#000000' }), false)
	assert.equal(canRebaseConnector(board, { ...original, from: 'b' }), false)
	assert.equal(canRebaseConnector(board, { ...original, to: 'b' }), false)
	assert.equal(canRebaseConnector(board, { ...original, fromAnchor: 3 }), false)
	assert.equal(canRebaseConnector(board, { ...original, toAnchor: undefined }), false)
	assert.equal(canRebaseConnector({ revision: 3, shapes: [] }, original), false)
	assert.equal(
		canRebaseConnector({ revision: 3, shapes: [{ ...rectangle, id: 'c' }] }, original),
		false,
	)
})
