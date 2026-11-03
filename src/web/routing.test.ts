import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasShape } from '../shared/types.ts'
import { getAnchors, type Point } from './anchors.ts'
import { getConnectorRoute } from './routing.ts'

const rectangle: CanvasShape = {
	id: 'a',
	type: 'rectangle',
	x: 0,
	y: 0,
	w: 100,
	h: 100,
	color: '#5b5fc7',
}

function isInside(point: Point, shape: CanvasShape): boolean {
	if (shape.type === 'ellipse') {
		const x = (point.x - shape.x - shape.w / 2) / (shape.w / 2)
		const y = (point.y - shape.y - shape.h / 2) / (shape.h / 2)
		return x * x + y * y < 1 - 1e-10
	}
	return (
		point.x > shape.x &&
		point.x < shape.x + shape.w &&
		point.y > shape.y &&
		point.y < shape.y + shape.h
	)
}

function assertRouteAvoids(route: Point[], shapes: CanvasShape[]): void {
	for (let index = 1; index < route.length; index++) {
		const a = route[index - 1]
		const b = route[index]
		for (let step = 1; step < 100; step++) {
			const point = { x: a.x + ((b.x - a.x) * step) / 100, y: a.y + ((b.y - a.y) * step) / 100 }
			assert.equal(
				shapes.some((shape) => isInside(point, shape)),
				false,
			)
		}
	}
}

test('manual connections route around both endpoint shapes', () => {
	const other = { ...rectangle, id: 'b', x: 200 }
	const start = getAnchors(rectangle)[2]
	const end = getAnchors(other)[3]
	const route = getConnectorRoute(rectangle, other, start, end, 2, 3)
	assert.deepEqual(route[0], start)
	assert.deepEqual(route.at(-1), end)
	assert.ok(route.length > 2)
	assertRouteAvoids(route, [rectangle, other])
})

test('non-overlapping ellipses route through empty bounding-box corners', () => {
	const from = { ...rectangle, type: 'ellipse' as const }
	const to = { ...from, id: 'b', x: 80, y: 61 }
	const route = getConnectorRoute(from, to, getAnchors(from)[11], getAnchors(to)[3], 11, 3)
	assertRouteAvoids(route, [from, to])
})

test('nearby unequal ellipses avoid crossing nodes at exposed anchors', () => {
	const from = { ...rectangle, type: 'ellipse' as const }
	const to = { ...from, id: 'b', x: 97, y: 60, w: 20, h: 20 }
	const route = getConnectorRoute(from, to, getAnchors(from)[11], getAnchors(to)[3], 11, 3)
	assertRouteAvoids(route, [from, to])
})

test('very close ellipses find a visible route between exposed anchors', () => {
	const from = { ...rectangle, type: 'ellipse' as const }
	const to = { ...from, id: 'b', x: 98.9134624470467, y: 55.92879988703632, w: 10, h: 10 }
	const route = getConnectorRoute(from, to, getAnchors(from)[0], getAnchors(to)[6], 0, 6)
	assertRouteAvoids(route, [from, to])
})

test('facing anchors connect directly even with a narrow gap', () => {
	const other = { ...rectangle, id: 'b', x: 101 }
	const start = getAnchors(rectangle)[3]
	const end = getAnchors(other)[2]
	assert.deepEqual(getConnectorRoute(rectangle, other, start, end, 3, 2), [start, end])
})
