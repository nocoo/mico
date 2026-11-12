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

test('note outline preserves world radius and inverse-zoom screen dimensions', () => {
	for (const zoom of [0.5, 1, 2, 3]) {
		assert.deepEqual(selectionOutlineGeometry(shape('note'), zoom), {
			x: 100,
			y: 50,
			width: 160,
			height: 160,
			radius: 22,
			outlineWidth: 2.5 / zoom,
			outlineOffset: 5 / zoom,
		})
	}
})

test('shape radii match their visual family', () => {
	assert.equal(selectionOutlineGeometry(shape('rectangle'), 1).radius, 22)
	assert.equal(selectionOutlineGeometry(shape('rectangle', { text: 'Node' }), 1).radius, 20)
	assert.equal(selectionOutlineGeometry(shape('ellipse'), 1).radius, '50%')
	assert.equal(selectionOutlineGeometry(shape('text'), 1).radius, 0)
	assert.equal(selectionOutlineGeometry(shape('frame'), 1).radius, 18)
	assert.equal(selectionOutlineGeometry(shape('html'), 1).radius, 32)
	assert.equal(selectionOutlineGeometry(shape('image'), 1).radius, 10)
})

test('signed lines and zero-size shapes retain usable bounds', () => {
	assert.deepEqual(selectionOutlineGeometry(shape('line', { x: 100, y: 50, w: -40, h: 20 }), 1), {
		x: 60,
		y: 50,
		width: 40,
		height: 20,
		radius: 4,
		outlineWidth: 2.5,
		outlineOffset: 5,
	})
	const tiny = selectionOutlineGeometry(shape('note', { w: 0, h: 0 }), 2)
	assert.equal(tiny.width, 0.5)
	assert.equal(tiny.height, 0.5)
})

test('invalid zoom and geometry are rejected', () => {
	for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
		assert.throws(() => selectionOutlineGeometry(shape('note'), zoom), RangeError)
	assert.throws(() => selectionOutlineGeometry(shape('note', { w: Number.NaN }), 1), RangeError)
})
