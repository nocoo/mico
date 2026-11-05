import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasShape, Connector, Shape } from '../shared/types.ts'
import {
	boundsOf,
	expandRect,
	intersects,
	normalizeRect,
	selectInRect,
	shapeBounds,
} from './selection.ts'

const rectangle = (id: string, x: number, y: number, w: number, h: number): CanvasShape => ({
	id,
	type: 'rectangle',
	x,
	y,
	w,
	h,
	color: '#5b5fc7',
})

const connector = (id: string, from: string, to: string): Connector => ({
	id,
	type: 'connector',
	from,
	to,
	color: '#616161',
})

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const nested of Object.values(value as Record<string, unknown>)) {
			deepFreeze(nested)
		}
		Object.freeze(value)
	}
	return value
}

test('a marquee rect normalizes every drag direction', () => {
	assert.deepEqual(normalizeRect({ x: 10, y: 20 }, { x: 30, y: 60 }), {
		x: 10,
		y: 20,
		w: 20,
		h: 40,
	})
	assert.deepEqual(normalizeRect({ x: 30, y: 60 }, { x: 10, y: 20 }), {
		x: 10,
		y: 20,
		w: 20,
		h: 40,
	})
	assert.deepEqual(normalizeRect({ x: 30, y: 20 }, { x: 10, y: 60 }), {
		x: 10,
		y: 20,
		w: 20,
		h: 40,
	})
	assert.deepEqual(normalizeRect({ x: 25, y: 25 }, { x: 25, y: 25 }), {
		x: 25,
		y: 25,
		w: 0,
		h: 0,
	})
})

test('shape bounds normalize signed lines and keep path boxes', () => {
	assert.deepEqual(
		shapeBounds({ id: 'l', type: 'line', x: 100, y: 50, w: -40, h: 20, color: '#616161' }),
		{ x: 60, y: 50, w: 40, h: 20 },
	)
	assert.deepEqual(
		shapeBounds({ id: 'l', type: 'line', x: 60, y: 50, w: 40, h: -20, color: '#616161' }),
		{ x: 60, y: 30, w: 40, h: 20 },
	)
	assert.deepEqual(shapeBounds(rectangle('r', 10, 20, 30, 40)), {
		x: 10,
		y: 20,
		w: 30,
		h: 40,
	})
	assert.deepEqual(
		shapeBounds({ id: 'p', type: 'path', x: 5, y: 6, w: 7, h: 8, color: '#000000' }),
		{ x: 5, y: 6, w: 7, h: 8 },
	)
	assert.deepEqual(shapeBounds(rectangle('z', 12, 14, 0, 0)), {
		x: 12,
		y: 14,
		w: 0,
		h: 0,
	})
	assert.throws(
		() =>
			shapeBounds({
				id: 'bad',
				type: 'rectangle',
				x: Number.NaN,
				y: 0,
				w: 10,
				h: 10,
				color: '#000000',
			}),
		RangeError,
	)
})

test('intersects counts touching edges, containment and zero-size shapes', () => {
	const box = { x: 0, y: 0, w: 10, h: 10 }
	assert.equal(intersects(box, { x: 10, y: 0, w: 10, h: 10 }), true)
	assert.equal(intersects(box, { x: 0, y: 10, w: 10, h: 10 }), true)
	assert.equal(intersects(box, { x: 10, y: 10, w: 0, h: 0 }), true)
	assert.equal(intersects(box, { x: 2, y: 2, w: 2, h: 2 }), true)
	assert.equal(intersects(box, { x: 1, y: 1, w: 20, h: 20 }), true)
	assert.equal(intersects(box, { x: 20, y: 20, w: 5, h: 5 }), false)
	assert.equal(intersects({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }), true)
	assert.equal(intersects({ x: 0, y: 0, w: 0, h: 0 }, { x: 1, y: 0, w: 0, h: 0 }), false)
})

test('marquee and frame bounds include image shapes', () => {
	const image: CanvasShape = {
		id: 'image',
		type: 'image',
		x: 20,
		y: 30,
		w: 120,
		h: 80,
		color: '#616161',
		imageId: 'asset-image',
	}
	assert.deepEqual(selectInRect([image], { x: 0, y: 0, w: 200, h: 200 }), ['image'])
	assert.deepEqual(boundsOf([image], ['image']), { x: 20, y: 30, w: 120, h: 80 })
})

test('a marquee selects intersecting shapes in input order without duplicates', () => {
	const shapes: Shape[] = [
		rectangle('first', 10, 10, 20, 20),
		connector('link', 'first', 'second'),
		rectangle('second', 30, 30, 20, 20),
		rectangle('first', 12, 12, 5, 5),
		rectangle('outside', 200, 200, 10, 10),
	]
	assert.deepEqual(selectInRect(shapes, { x: 0, y: 0, w: 100, h: 100 }), ['first', 'second'])
	assert.deepEqual(selectInRect(shapes, { x: 32, y: 32, w: 10, h: 10 }), ['second'])
})

test('a marquee skips malformed and nonfinite shapes', () => {
	const shapes = [
		rectangle('ok', 10, 10, 20, 20),
		{ id: 'nan', type: 'rectangle', x: Number.NaN, y: 10, w: 20, h: 20, color: '#000000' },
		{
			id: 'infinite',
			type: 'rectangle',
			x: 0,
			y: 0,
			w: Number.POSITIVE_INFINITY,
			h: 20,
			color: '#000',
		},
		{ id: 'future', type: 'frame', x: 10, y: 10, w: 20, h: 20, color: '#000000' },
		{ type: 'rectangle', x: 10, y: 10, w: 20, h: 20, color: '#000000' },
		{ id: '', type: 'rectangle', x: 10, y: 10, w: 20, h: 20, color: '#000000' },
		null,
	] as unknown as Shape[]
	assert.deepEqual(selectInRect(shapes, { x: 0, y: 0, w: 100, h: 100 }), ['ok'])
	assert.deepEqual(selectInRect(shapes, { x: Number.NaN, y: 0, w: 100, h: 100 }), [])
})

test('bounds cover only named canvas shapes', () => {
	const shapes: Shape[] = [
		rectangle('a', 10, 10, 20, 20),
		connector('c', 'a', 'b'),
		rectangle('b', 100, 40, 20, 20),
	]
	assert.deepEqual(boundsOf(shapes, ['a']), { x: 10, y: 10, w: 20, h: 20 })
	assert.deepEqual(boundsOf(shapes, ['a', 'b']), { x: 10, y: 10, w: 110, h: 50 })
	assert.equal(boundsOf(shapes, []), null)
	assert.equal(boundsOf(shapes, ['missing']), null)
	assert.equal(boundsOf(shapes, ['c']), null)
	assert.equal(boundsOf([], ['a']), null)
})

test('a rect grows by a finite padding and rejects invalid padding', () => {
	assert.deepEqual(expandRect({ x: 10, y: 20, w: 30, h: 40 }, 5), {
		x: 5,
		y: 15,
		w: 40,
		h: 50,
	})
	assert.deepEqual(expandRect({ x: 10, y: 20, w: 30, h: 40 }, 0), {
		x: 10,
		y: 20,
		w: 30,
		h: 40,
	})
	assert.throws(() => expandRect({ x: 0, y: 0, w: 1, h: 1 }, -1), RangeError)
	assert.throws(() => expandRect({ x: 0, y: 0, w: 1, h: 1 }, Number.NaN), RangeError)
	assert.throws(() => expandRect({ x: 0, y: 0, w: 1, h: 1 }, Number.POSITIVE_INFINITY), RangeError)
})

test('selection helpers never mutate their inputs', () => {
	const shapes = deepFreeze<Shape[]>([
		rectangle('a', 10, 10, 20, 20),
		rectangle('b', 40, 40, 20, 20),
	])
	const rect = deepFreeze({ x: 0, y: 0, w: 100, h: 100 })

	assert.deepEqual(selectInRect(shapes, rect), ['a', 'b'])
	assert.deepEqual(boundsOf(shapes, ['a', 'b']), { x: 10, y: 10, w: 50, h: 50 })
	assert.deepEqual(expandRect(rect, 1), { x: -1, y: -1, w: 102, h: 102 })
	assert.deepEqual(shapes, [rectangle('a', 10, 10, 20, 20), rectangle('b', 40, 40, 20, 20)])
	assert.deepEqual(rect, { x: 0, y: 0, w: 100, h: 100 })
})
