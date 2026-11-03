import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasShape, Shape } from '../shared/types.ts'
import { GRID_SNAP_WORLD } from './grid.ts'
import { snapMove } from './snap.ts'

const rect = (id: string, x: number, y: number, w: number, h: number): CanvasShape => ({
	id,
	type: 'rectangle',
	x,
	y,
	w,
	h,
	color: '#5b5fc7',
})

const moving = rect('m', 0, 0, 40, 20)

test('grid snap rounds the origin to the visible 16px grid', () => {
	assert.equal(GRID_SNAP_WORLD, 16)
	const result = snapMove(moving, { x: 21, y: 5 }, [], 1)
	assert.equal(result.x, 16)
	assert.equal(result.y, 0)
	assert.deepEqual(result.guides, [])
})

test('grid snap handles negative coordinates', () => {
	const result = snapMove(moving, { x: -21, y: -13 }, [], 1)
	assert.equal(result.x, -16)
	assert.equal(result.y, -16)
	assert.deepEqual(result.guides, [])
})

test('grid snap breaks ties toward positive infinity and never yields negative zero', () => {
	const positive = snapMove(moving, { x: 8, y: 24 }, [], 1)
	assert.equal(positive.x, 16)
	assert.equal(positive.y, 32)
	const negative = snapMove(moving, { x: -8, y: -24 }, [], 1)
	assert.equal(negative.x, 0)
	assert.equal(negative.y, -16)
	assert.equal(Object.is(negative.x, 0), true)
})

test('element alignment wins over the grid on the same axis', () => {
	const peer = rect('peer', 100, 280, 50, 30)
	const result = snapMove(moving, { x: 100.4, y: 300.6 }, [peer], 1)
	assert.equal(result.x, 100)
	assert.equal(result.y, 304)
	assert.deepEqual(result.guides, [{ axis: 'x', value: 100, from: 280, to: 324 }])
})

test('x and y align independently to different peers', () => {
	const peerA = rect('a', 100, 200, 60, 40)
	const peerB = rect('b', 300, 100, 60, 40)
	const result = snapMove(moving, { x: 100.5, y: 100.5 }, [peerA, peerB], 1)
	assert.equal(result.x, 100)
	assert.equal(result.y, 100)
	assert.deepEqual(result.guides, [
		{ axis: 'x', value: 100, from: 100, to: 240 },
		{ axis: 'y', value: 100, from: 100, to: 360 },
	])
})

test('center alignment snaps both axes to the peer center', () => {
	const peer = rect('peer', 100, 100, 60, 60)
	const square = rect('m', 0, 0, 40, 40)
	const result = snapMove(square, { x: 110.4, y: 110.4 }, [peer], 1)
	assert.equal(result.x, 110)
	assert.equal(result.y, 110)
	assert.deepEqual(result.guides, [
		{ axis: 'x', value: 130, from: 100, to: 160 },
		{ axis: 'y', value: 130, from: 100, to: 160 },
	])
})

test('edge alignment never mixes an edge with a center', () => {
	const peer = rect('peer', 100, 100, 60, 60)
	const square = rect('m', 0, 0, 40, 40)
	const result = snapMove(square, { x: 100.4, y: 100.4 }, [peer], 1)
	assert.equal(result.x, 100)
	assert.equal(result.y, 100)
	assert.deepEqual(result.guides, [
		{ axis: 'x', value: 100, from: 100, to: 160 },
		{ axis: 'y', value: 100, from: 100, to: 160 },
	])
})

test('the six screen pixel threshold scales with zoom', () => {
	const peer = rect('peer', 100, 100, 100, 100)
	const near = snapMove(moving, { x: 105, y: 105 }, [peer], 1)
	assert.equal(near.x, 100)
	assert.equal(near.y, 100)
	const zoomedOut = snapMove(moving, { x: 105, y: 105 }, [peer], 0.5)
	assert.equal(zoomedOut.x, 100)
	assert.equal(zoomedOut.y, 100)
	const zoomedIn = snapMove(moving, { x: 105, y: 105 }, [peer], 2)
	assert.equal(zoomedIn.x, 112)
	assert.equal(zoomedIn.y, 112)
	assert.deepEqual(zoomedIn.guides, [])
})

test('the 160 screen pixel radius scales with zoom', () => {
	const peer = rect('peer', 100, 400, 50, 30)
	const excluded = snapMove(moving, { x: 100.4, y: 100.4 }, [peer], 1)
	assert.equal(excluded.x, 96)
	assert.deepEqual(excluded.guides, [])
	const included = snapMove(moving, { x: 100.4, y: 100.4 }, [peer], 0.25)
	assert.equal(included.x, 100)
	assert.equal(included.y, 96)
})

test('peers beyond the 160 screen pixel radius are ignored', () => {
	const far = rect('far', 1000, 1000, 50, 30)
	const result = snapMove(moving, { x: 100.4, y: 100.4 }, [far], 1)
	assert.equal(result.x, 96)
	assert.equal(result.y, 96)
	assert.deepEqual(result.guides, [])
})

test('a peer within the radius but beyond the alignment threshold is ignored', () => {
	const peer = rect('peer', 120, 100, 50, 30)
	const result = snapMove(moving, { x: 100.4, y: 100.4 }, [peer], 1)
	assert.equal(result.x, 96)
	assert.equal(result.y, 100)
	assert.deepEqual(result.guides, [{ axis: 'y', value: 100, from: 96, to: 170 }])
})

test('signed line bounds are normalized before alignment', () => {
	const line: CanvasShape = {
		id: 'm',
		type: 'line',
		x: 0,
		y: 0,
		w: -40,
		h: 20,
		color: '#5b5fc7',
	}
	const peer = rect('peer', 100, 100, 50, 30)
	const result = snapMove(line, { x: 140.4, y: 100.4 }, [peer], 1)
	assert.equal(result.x, 140)
	assert.equal(result.y, 100)
	assert.deepEqual(result.guides, [
		{ axis: 'x', value: 100, from: 100, to: 130 },
		{ axis: 'y', value: 100, from: 100, to: 150 },
	])
})

test('connectors and the moving shape never act as alignment peers', () => {
	const connector: Shape = { id: 'c', type: 'connector', from: 'm', to: 'peer', color: '#5b5fc7' }
	const shapes: Shape[] = [moving, connector]
	const result = snapMove(moving, { x: 100.4, y: 100.4 }, shapes, 1)
	assert.equal(result.x, 96)
	assert.equal(result.y, 96)
	assert.deepEqual(result.guides, [])
})

test('same-feature alignment beats cross-edge alignment on ties', () => {
	const peer = rect('peer', 101, 100, 4, 20)
	const thin = rect('m', 0, 0, 4, 20)
	const result = snapMove(thin, { x: 103, y: 250 }, [peer], 1)
	assert.equal(result.x, 101)
	assert.equal(result.y, 256)
	assert.deepEqual(result.guides, [{ axis: 'x', value: 101, from: 100, to: 276 }])
})

test('equal-size peers report the shared edge as the guide', () => {
	const peer = rect('peer', 100, 100, 40, 40)
	const square = rect('m', 0, 0, 40, 40)
	const result = snapMove(square, { x: 105, y: 105 }, [peer], 1)
	assert.equal(result.x, 100)
	assert.equal(result.y, 100)
	assert.deepEqual(result.guides, [
		{ axis: 'x', value: 100, from: 100, to: 140 },
		{ axis: 'y', value: 100, from: 100, to: 140 },
	])
})

test('a guide spans the moved node and every matching neighbor', () => {
	const upper = rect('upper', 100, 100, 40, 30)
	const lower = rect('lower', 100, 200, 40, 30)
	const result = snapMove(moving, { x: 100.4, y: 150 }, [upper, lower], 1)
	assert.equal(result.x, 100)
	assert.equal(result.y, 144)
	assert.deepEqual(result.guides, [{ axis: 'x', value: 100, from: 100, to: 230 }])
})

test('grid-only snapping never emits guides', () => {
	const result = snapMove(moving, { x: 13, y: 5 }, [], 1)
	assert.equal(result.guides.length, 0)
})

test('snapMove never mutates its inputs', () => {
	const shape = rect('m', 7, 9, 40, 20)
	const peer = rect('peer', 100, 100, 50, 30)
	const shapes: Shape[] = [peer]
	const snapshotShapes = structuredClone(shapes)
	const snapshotShape = structuredClone(shape)
	const snapshotPosition = { x: 100.4, y: 100.4 }
	snapMove(shape, snapshotPosition, shapes, 1)
	assert.deepEqual(shapes, snapshotShapes)
	assert.deepEqual(shape, snapshotShape)
	assert.deepEqual(snapshotPosition, { x: 100.4, y: 100.4 })
})

test('snapMove rejects nonfinite positions and invalid zooms', () => {
	assert.throws(() => snapMove(moving, { x: Number.NaN, y: 0 }, [], 1), RangeError)
	assert.throws(() => snapMove(moving, { x: 0, y: Number.POSITIVE_INFINITY }, [], 1), RangeError)
	assert.throws(() => snapMove(moving, { x: 0, y: 0 }, [], 0), RangeError)
	assert.throws(() => snapMove(moving, { x: 0, y: 0 }, [], -1), RangeError)
	assert.throws(() => snapMove(moving, { x: 0, y: 0 }, [], Number.NaN), RangeError)
	assert.throws(() => snapMove(moving, { x: 0, y: 0 }, [], Number.POSITIVE_INFINITY), RangeError)
	assert.throws(() => snapMove({ ...moving, w: Number.NaN }, { x: 0, y: 0 }, [], 1), RangeError)
})

test('malformed peers are skipped instead of breaking the move', () => {
	const broken = { ...rect('broken', Number.NaN, 10, 10, 10) }
	const peer = rect('peer', 100, 100, 50, 30)
	const result = snapMove(moving, { x: 100.4, y: 100.4 }, [broken, peer], 1)
	assert.equal(result.x, 100)
	assert.equal(result.y, 100)
})
