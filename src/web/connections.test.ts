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

	const thickLine: CanvasShape = {
		id: 'thick-line',
		type: 'line',
		x: 0,
		y: 0,
		w: 100,
		h: 0,
		color: '#5b5fc7',
		strokeWidth: 64,
	}
	const thick = trimConnectorHitSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, thickLine, thickLine)
	assert.deepEqual(thick, { start: { x: 32, y: 0 }, end: { x: 68, y: 0 }, short: false })
	const thickZoomed = trimConnectorHitSegment(
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		2,
		thickLine,
		thickLine,
	)
	assert.deepEqual(thickZoomed, { start: { x: 32, y: 0 }, end: { x: 68, y: 0 }, short: false })
})

test('short thick-node overlap has no fallback hit segment', () => {
	const thickA: CanvasShape = {
		id: 'A',
		type: 'rectangle',
		x: 0,
		y: 0,
		w: 100,
		h: 100,
		color: '#5b5fc7',
		strokeWidth: 64,
	}
	const thinB: CanvasShape = {
		id: 'B',
		type: 'rectangle',
		x: 160,
		y: 0,
		w: 100,
		h: 100,
		color: '#5b5fc7',
		strokeWidth: 2,
	}
	const overlappingB: CanvasShape = { ...thinB, x: 80 }
	const noGap = trimConnectorHitSegment(
		{ x: 100, y: 50 },
		{ x: 80, y: 50 },
		1,
		thickA,
		overlappingB,
	)
	assert.equal(noGap.safe, false)
	assert.equal(noGap.short, true)
	assert.deepEqual(noGap.start, noGap.end)

	const farThinB: CanvasShape = { ...thinB, x: 300 }
	const safeGap = trimConnectorHitSegment({ x: 100, y: 50 }, { x: 300, y: 50 }, 1, thickA, farThinB)
	assert.notEqual(safeGap.safe, false)
	assert.equal(safeGap.short, false)
	assert.ok(safeGap.start.x > 100)
	assert.ok(safeGap.end.x < 300)
	assert.ok(safeGap.start.x < safeGap.end.x)

	const flatEllipse: CanvasShape = {
		id: 'flat',
		type: 'ellipse',
		x: 0,
		y: 0,
		w: 400,
		h: 20,
		color: '#5b5fc7',
		strokeWidth: 64,
	}
	const flatDiagonal = trimConnectorHitSegment({ x: 400, y: 10 }, { x: 500, y: 50 }, 3, flatEllipse)
	assert.equal(flatDiagonal.short, false)
	assert.ok(flatDiagonal.start.x > 430)
	assert.ok(flatDiagonal.start.y > 15)
})

test('overlapping ellipse bounding boxes do not hide a visible connector gap', () => {
	const first: CanvasShape = { ...ellipse, id: 'first', strokeWidth: 2 }
	const second: CanvasShape = { ...ellipse, id: 'second', x: 80, y: 80, strokeWidth: 2 }
	const offset = 50 / Math.sqrt(2)
	const segment = trimConnectorHitSegment(
		{ x: 50 + offset, y: 50 + offset },
		{ x: 130 - offset, y: 130 - offset },
		1,
		first,
		second,
	)
	assert.notEqual(segment.safe, false)
	assert.ok(segment.start.x < segment.end.x)
})

test('diagonal rectangle and ellipse trims include stroke and 16px hit band', () => {
	const thickRect: CanvasShape = {
		id: 'diagonal-rect',
		type: 'rectangle',
		x: 0,
		y: 0,
		w: 100,
		h: 100,
		color: '#5b5fc7',
		strokeWidth: 64,
	}
	const rectZoom1 = trimConnectorHitSegment({ x: 100, y: 100 }, { x: 180, y: 180 }, 1, thickRect)
	assert.ok(Math.abs(rectZoom1.start.x - 148) < 1e-9)
	assert.ok(Math.abs(rectZoom1.start.y - 148) < 1e-9)
	const rectZoom2 = trimConnectorHitSegment({ x: 100, y: 100 }, { x: 180, y: 180 }, 2, thickRect)
	assert.ok(Math.abs(rectZoom2.start.x - 140) < 1e-9)
	assert.ok(Math.abs(rectZoom2.start.y - 140) < 1e-9)

	const thickEllipse: CanvasShape = {
		id: 'diagonal-ellipse',
		type: 'ellipse',
		x: 0,
		y: 0,
		w: 100,
		h: 100,
		color: '#5b5fc7',
		strokeWidth: 64,
	}
	const ellipseZoom1 = trimConnectorHitSegment(
		{ x: 100, y: 50 },
		{ x: 180, y: 130 },
		1,
		thickEllipse,
	)
	const ellipseZoom2 = trimConnectorHitSegment(
		{ x: 100, y: 50 },
		{ x: 180, y: 130 },
		2,
		thickEllipse,
	)
	const ellipse1Distance = Math.hypot(ellipseZoom1.start.x - 100, ellipseZoom1.start.y - 50)
	const ellipse2Distance = Math.hypot(ellipseZoom2.start.x - 100, ellipseZoom2.start.y - 50)
	assert.ok(ellipse1Distance > 32)
	assert.ok(ellipse2Distance > 32)
	assert.ok(ellipseZoom1.start.x > ellipseZoom2.start.x)

	const ellipsePoint = ellipseZoom1.start
	const rx = 50 + 32 + 16
	const ry = 50 + 32 + 16
	assert.ok(((ellipsePoint.x - 50) / rx) ** 2 + ((ellipsePoint.y - 50) / ry) ** 2 >= 0.999)
})

test('snapping picks the nearest anchor of the closest node', () => {
	const target = findSnapTarget([rectangle], { x: 52, y: 2 }, 'other', 1)
	assert.deepEqual(target, { shapeId: 'a', anchorIndex: 0, point: { x: 50, y: 0 } })
})

test('thick rectangle and ellipse strokes extend the snap boundary', () => {
	const thickRect: CanvasShape = {
		id: 'thick-rect',
		type: 'rectangle',
		x: 0,
		y: 0,
		w: 100,
		h: 100,
		color: '#5b5fc7',
		strokeWidth: 40,
	}
	assert.ok(findSnapTarget([thickRect], { x: -30, y: 50 }, 'other', 1))
	assert.equal(findSnapTarget([thickRect], { x: -46, y: 50 }, 'other', 1), null)
	assert.ok(findSnapTarget([thickRect], { x: -30, y: 50 }, 'other', 2))
	assert.equal(findSnapTarget([thickRect], { x: -36, y: 50 }, 'other', 2), null)

	const thickEllipse: CanvasShape = {
		id: 'thick-ellipse',
		type: 'ellipse',
		x: 0,
		y: 0,
		w: 100,
		h: 100,
		color: '#5b5fc7',
		strokeWidth: 40,
	}
	assert.ok(findSnapTarget([thickEllipse], { x: -26, y: 50 }, 'other', 1))
	assert.ok(findSnapTarget([thickEllipse], { x: 40, y: 50 }, 'other', 1))
	assert.equal(findSnapTarget([thickEllipse], { x: -50, y: 50 }, 'other', 1), null)
	assert.ok(findSnapTarget([thickEllipse], { x: -26, y: 50 }, 'other', 2))
	assert.equal(findSnapTarget([thickEllipse], { x: -36, y: 50 }, 'other', 2), null)
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
