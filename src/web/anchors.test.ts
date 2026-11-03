import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasShape } from '../shared/types.ts'
import { ANCHOR_COUNTS } from '../shared/types.ts'
import { getAnchors, getConnectorAnchors } from './anchors.ts'

const rectangle: CanvasShape = {
	id: 'a',
	type: 'rectangle',
	x: 0,
	y: 0,
	w: 120,
	h: 90,
	color: '#5b5fc7',
}

test('box anchors are fixed at the midpoint and thirds of each side', () => {
	const anchors = getAnchors(rectangle)
	assert.equal(anchors.length, 12)
	for (const point of [
		{ x: 60, y: 0 },
		{ x: 40, y: 90 },
		{ x: 0, y: 30 },
		{ x: 120, y: 60 },
	]) {
		assert.ok(
			anchors.some(
				(anchor) => Math.abs(anchor.x - point.x) < 1e-8 && Math.abs(anchor.y - point.y) < 1e-8,
			),
		)
	}
})

test('connectors choose the nearest candidate anchor pair', () => {
	const other = { ...rectangle, id: 'b', x: 240 }
	assert.deepEqual(getConnectorAnchors(rectangle, other), {
		start: { x: 120, y: 45 },
		end: { x: 240, y: 45 },
	})
	const shifted = { ...other, x: 40, y: 140 }
	const { start, end } = getConnectorAnchors(rectangle, shifted)
	assert.equal(start.y, 90)
	assert.equal(end.y, 140)
	assert.ok(Math.abs(start.x - end.x) < 1e-8)
})

test('connectors leave both shapes outward rather than passing through their interiors', () => {
	const tall = { ...rectangle, x: 0, y: 0, w: 40, h: 200 }
	const small = { ...rectangle, id: 'b', x: 50, y: 0, w: 20, h: 20 }
	const { start, end } = getConnectorAnchors(tall, small)
	assert.equal(start.x, 40)
	assert.ok(end.x === 50 || end.y === 20)
})

test('ellipse anchors remain on its boundary and lines support signed offsets', () => {
	const ellipse = { ...rectangle, type: 'ellipse' as const }
	for (const anchor of getAnchors(ellipse)) {
		const distance = ((anchor.x - 60) / 60) ** 2 + ((anchor.y - 45) / 45) ** 2
		assert.ok(Math.abs(distance - 1) < 1e-10)
	}
	const line = { ...rectangle, type: 'line' as const, x: 100, y: 80, w: -60, h: -30 }
	const anchors = getAnchors(line)
	assert.deepEqual(anchors[0], { x: 100, y: 80 })
	assert.deepEqual(anchors.at(-1), { x: 40, y: 50 })
})

test('anchor counts match the shared anchor table for every shape type', () => {
	const ellipse = { ...rectangle, type: 'ellipse' as const }
	const text = { ...rectangle, type: 'text' as const }
	const line = { ...rectangle, type: 'line' as const }
	assert.equal(getAnchors(rectangle).length, ANCHOR_COUNTS.rectangle)
	assert.equal(getAnchors(ellipse).length, ANCHOR_COUNTS.ellipse)
	assert.equal(getAnchors(text).length, ANCHOR_COUNTS.text)
	assert.equal(getAnchors(line).length, ANCHOR_COUNTS.line)
	assert.equal(ANCHOR_COUNTS.rectangle, 12)
	assert.equal(ANCHOR_COUNTS.ellipse, 12)
	assert.equal(ANCHOR_COUNTS.text, 12)
	assert.equal(ANCHOR_COUNTS.line, 5)
})

test('pinned endpoints are honored exactly', () => {
	const other = { ...rectangle, id: 'b', x: 240 }
	const pinned = getConnectorAnchors(rectangle, other, { fromAnchor: 3, toAnchor: 3 })
	assert.deepEqual(pinned, { start: { x: 120, y: 45 }, end: { x: 360, y: 45 } })

	const both = getConnectorAnchors(rectangle, other, { fromAnchor: 0, toAnchor: 1 })
	assert.deepEqual(both, { start: { x: 60, y: 0 }, end: { x: 300, y: 90 } })
})

test('a pinned endpoint bypasses the outward restriction only for that endpoint', () => {
	const other = { ...rectangle, id: 'b', x: 240 }
	const inwardStart = getConnectorAnchors(rectangle, other, { fromAnchor: 2 })
	assert.deepEqual(inwardStart.start, { x: 0, y: 45 })
	assert.equal(inwardStart.end.x, 240)

	const inwardEnd = getConnectorAnchors(rectangle, other, { toAnchor: 1 })
	assert.deepEqual(inwardEnd.end, { x: 300, y: 90 })
	assert.equal(inwardEnd.start.x, 120)
})

test('connectors without pins keep auto routing', () => {
	const other = { ...rectangle, id: 'b', x: 240 }
	assert.deepEqual(getConnectorAnchors(rectangle, other), getConnectorAnchors(rectangle, other, {}))
	assert.deepEqual(getConnectorAnchors(rectangle, other, { fromAnchor: undefined }), {
		start: { x: 120, y: 45 },
		end: { x: 240, y: 45 },
	})
})

test('invalid pins fail explicitly rather than silently changing the selected anchor', () => {
	const other = { ...rectangle, id: 'b', x: 240 }
	assert.throws(() => getConnectorAnchors(rectangle, other, { fromAnchor: 99 }), RangeError)
	assert.throws(() => getConnectorAnchors(rectangle, other, { fromAnchor: -1 }), RangeError)
	assert.throws(() => getConnectorAnchors(rectangle, other, { toAnchor: 1.5 }), RangeError)
})
