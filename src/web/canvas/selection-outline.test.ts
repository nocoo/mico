import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasShape } from '../../shared/types.ts'
import { selectionOutlineGeometry } from './selection-outline.ts'

const shape = (type: CanvasShape['type'], extra: Partial<CanvasShape> = {}): CanvasShape => ({
	id: 'shape',
	type,
	x: 100,
	y: 50,
	w: 160,
	h: 160,
	color: '#123456',
	...extra,
})

test('note outlines scale the world corner radius and add screen-space offset', () => {
	assert.deepEqual(selectionOutlineGeometry(shape('note'), 0.5), {
		kind: 'rect',
		x: 90,
		y: 40,
		width: 180,
		height: 180,
		rx: 32,
	})
	assert.deepEqual(selectionOutlineGeometry(shape('note'), 1), {
		kind: 'rect',
		x: 95,
		y: 45,
		width: 170,
		height: 170,
		rx: 27,
	})
	assert.deepEqual(selectionOutlineGeometry(shape('note'), 2), {
		kind: 'rect',
		x: 97.5,
		y: 47.5,
		width: 165,
		height: 165,
		rx: 24.5,
	})
})

test('flow nodes keep their 20px world radius plus screen-space offset', () => {
	for (const [zoom, radius] of [
		[0.5, 30],
		[1, 25],
		[2, 22.5],
	] as const) {
		const outline = selectionOutlineGeometry(shape('rectangle', { text: 'Flow' }), zoom)
		assert.equal(outline.kind === 'rect' && outline.rx, radius)
	}
})

test('signed lines normalize to finite bounds', () => {
	assert.deepEqual(selectionOutlineGeometry(shape('line', { x: 100, y: 50, w: -40, h: 20 }), 1), {
		kind: 'rect',
		x: 55,
		y: 45,
		width: 50,
		height: 30,
		rx: 9,
	})
})

test('ellipse outlines preserve true ellipse geometry', () => {
	assert.deepEqual(selectionOutlineGeometry(shape('ellipse', { w: -40, h: 20 }), 1), {
		kind: 'ellipse',
		cx: 80,
		cy: 60,
		rx: 25,
		ry: 15,
	})
})

test('zero and tiny dimensions remain valid', () => {
	assert.deepEqual(selectionOutlineGeometry(shape('note', { w: 0, h: 0 }), 1), {
		kind: 'rect',
		x: 95,
		y: 45,
		width: 10,
		height: 10,
		rx: 5,
	})
	assert.deepEqual(selectionOutlineGeometry(shape('ellipse', { w: 0.01, h: 0.01 }), 1), {
		kind: 'ellipse',
		cx: 100.005,
		cy: 50.005,
		rx: 5.005,
		ry: 5.005,
	})
})

test('rectangles and other shape families use reference radii', () => {
	assert.equal(
		selectionOutlineGeometry(shape('rectangle'), 1).kind === 'rect' &&
			selectionOutlineGeometry(shape('rectangle'), 1).rx,
		27,
	)
	assert.equal(
		selectionOutlineGeometry(shape('rectangle', { text: 'Flow' }), 1).kind === 'rect' &&
			selectionOutlineGeometry(shape('rectangle', { text: 'Flow' }), 1).rx,
		25,
	)
	assert.equal(
		selectionOutlineGeometry(shape('frame'), 1).kind === 'rect' &&
			selectionOutlineGeometry(shape('frame'), 1).rx,
		15,
	)
	assert.equal(
		selectionOutlineGeometry(shape('html'), 1).kind === 'rect' &&
			selectionOutlineGeometry(shape('html'), 1).rx,
		15,
	)
	assert.equal(
		selectionOutlineGeometry(shape('image'), 1).kind === 'rect' &&
			selectionOutlineGeometry(shape('image'), 1).rx,
		15,
	)
	assert.equal(
		selectionOutlineGeometry(shape('text'), 1).kind === 'rect' &&
			selectionOutlineGeometry(shape('text'), 1).rx,
		11,
	)
	assert.equal(
		selectionOutlineGeometry(shape('path'), 1).kind === 'rect' &&
			selectionOutlineGeometry(shape('path'), 1).rx,
		9,
	)
})

test('invalid zoom and geometry are rejected explicitly', () => {
	for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
		assert.throws(() => selectionOutlineGeometry(shape('note'), zoom), RangeError)
	assert.throws(() => selectionOutlineGeometry(shape('note', { w: Number.NaN }), 1), RangeError)
	assert.throws(
		() => selectionOutlineGeometry(shape('note', { x: Number.POSITIVE_INFINITY }), 1),
		RangeError,
	)
})
