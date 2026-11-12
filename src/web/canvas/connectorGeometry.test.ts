import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasShape, Connector } from '../../shared/types.ts'
import {
	connectorPath,
	createConnectorGeometry,
	getConnectorGeometry,
} from './connectorGeometry.ts'

const box = (id: string, x: number, y: number): CanvasShape => ({
	id,
	type: 'rectangle',
	x,
	y,
	w: 100,
	h: 80,
	color: '#5b5fc7',
})

const connector = (overrides: Partial<Connector> = {}): Connector => ({
	id: 'edge',
	type: 'connector',
	from: 'from',
	to: 'to',
	color: '#5b5fc7',
	...overrides,
})

function assertFinite(geometry: ReturnType<typeof createConnectorGeometry>) {
	for (const point of [geometry.start, geometry.controlStart, geometry.controlEnd, geometry.end]) {
		assert.ok(Number.isFinite(point.x))
		assert.ok(Number.isFinite(point.y))
	}
}

test('connector curves route right and left with horizontal tangents', () => {
	const from = box('from', 0, 0)
	const right = getConnectorGeometry(connector(), from, box('to', 300, 0))
	assert.deepEqual(right.start, { x: 100, y: 40 })
	assert.deepEqual(right.end, { x: 300, y: 40 })
	assert.equal(right.controlStart.y, right.start.y)
	assert.equal(right.controlEnd.y, right.end.y)
	assert.ok(right.controlStart.x > right.start.x)
	assert.ok(right.controlEnd.x < right.end.x)

	const left = getConnectorGeometry(connector(), from, box('to', -300, 0))
	assert.deepEqual(left.start, { x: 0, y: 40 })
	assert.deepEqual(left.end, { x: -200, y: 40 })
	assert.equal(left.controlStart.y, left.start.y)
	assert.equal(left.controlEnd.y, left.end.y)
	assert.ok(left.controlStart.x < left.start.x)
	assert.ok(left.controlEnd.x > left.end.x)
})

test('connector curves route down and up with vertical tangents', () => {
	const from = box('from', 0, 0)
	const down = getConnectorGeometry(connector(), from, box('to', 0, 300))
	assert.deepEqual(down.start, { x: 50, y: 80 })
	assert.deepEqual(down.end, { x: 50, y: 300 })
	assert.equal(down.controlStart.x, down.start.x)
	assert.equal(down.controlEnd.x, down.end.x)
	assert.ok(down.controlStart.y > down.start.y)
	assert.ok(down.controlEnd.y < down.end.y)

	const up = getConnectorGeometry(connector(), from, box('to', 0, -300))
	assert.deepEqual(up.start, { x: 50, y: 0 })
	assert.deepEqual(up.end, { x: 50, y: -220 })
	assert.ok(up.controlStart.y < up.start.y)
	assert.ok(up.controlEnd.y > up.end.y)
})

test('pinned endpoints stay exact and control tangents leave their pinned sides', () => {
	const from = box('from', 0, 0)
	const to = box('to', 300, 100)
	const geometry = getConnectorGeometry(connector({ fromAnchor: 2, toAnchor: 7 }), from, to)

	assert.deepEqual(geometry.start, { x: 0, y: 40 })
	assert.deepEqual(geometry.end, { x: 400, y: 126.66666666666666 })
	assert.ok(geometry.controlStart.x < geometry.start.x)
	assert.ok(geometry.controlEnd.x > geometry.end.x)
	assert.match(connectorPath(geometry), /^M0 40C/)
	assert.match(connectorPath(geometry), / 400 126\.66666666666666$/)
})

test('degenerate and coincident endpoints remain finite without moving their anchors', () => {
	const dot: CanvasShape = {
		id: 'from',
		type: 'rectangle',
		x: 10,
		y: 20,
		w: 0,
		h: 0,
		color: '#5b5fc7',
	}
	const coincident = getConnectorGeometry(connector({ fromAnchor: 0, toAnchor: 0 }), dot, {
		...dot,
		id: 'to',
	})
	assertFinite(coincident)
	assert.deepEqual(coincident.start, { x: 10, y: 20 })
	assert.deepEqual(coincident.end, { x: 10, y: 20 })
	assert.deepEqual(coincident.controlStart, coincident.start)
	assert.deepEqual(coincident.controlEnd, coincident.end)
	assert.equal(connectorPath(coincident), 'M10 20C10 20 10 20 10 20')

	const unanchored = createConnectorGeometry(
		{ x: Number.MIN_VALUE, y: 0 },
		{ x: Number.MIN_VALUE, y: 0 },
	)
	assertFinite(unanchored)
	assert.deepEqual(unanchored.start, unanchored.end)
})

test('preview geometry uses anchor points without viewport data', () => {
	const start = { x: 100, y: 40 }
	const end = { x: 300, y: 40 }
	const geometry = createConnectorGeometry(start, end, box('from', 0, 0), box('to', 300, 0), {
		fromAnchor: 3,
		toAnchor: 2,
	})
	assert.deepEqual(geometry.start, start)
	assert.deepEqual(geometry.end, end)
	assert.equal(connectorPath(geometry), 'M100 40C200 40 200 40 300 40')
})
