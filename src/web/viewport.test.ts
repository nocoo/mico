import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasShape, Shape } from '../shared/types.ts'
import { getConnectorAnchors } from './anchors.ts'
import { getConnectorRoute } from './routing.ts'
import { fitViewport } from './viewport.ts'

const close = (actual: number, expected: number) => {
	assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`)
}

const shape = (patch: Partial<CanvasShape> = {}): CanvasShape => ({
	id: 'a',
	type: 'rectangle',
	x: 0,
	y: 0,
	w: 100,
	h: 100,
	color: '#5b5fc7',
	...patch,
})

test('fits large shapes with padding and centers them', () => {
	const result = fitViewport([shape({ w: 1000, h: 500 })], 800, 600)
	assert.ok(result)
	close(result.zoom, 0.64)
	close(result.x, 80)
	close(result.y, 140)

	const left = result.x
	const top = result.y
	const right = left + 1000 * result.zoom
	const bottom = top + 500 * result.zoom
	assert.ok(left >= 80 - 1e-8)
	assert.ok(top >= 60 - 1e-8)
	assert.ok(right <= 720 + 1e-8)
	assert.ok(bottom <= 540 + 1e-8)
})

test('includes negative coordinates and signed line endpoints', () => {
	const line = shape({ type: 'line', x: 100, y: 80, w: -60, h: -30 })
	const result = fitViewport([line], 800, 600)
	assert.ok(result)
	close(result.zoom, 1.5)
	close(result.x, 295)
	close(result.y, 202.5)

	assert.deepEqual(line, shape({ type: 'line', x: 100, y: 80, w: -60, h: -30 }))
})

test('uses the limiting axis for portrait and landscape bounds', () => {
	const portrait = fitViewport([shape({ x: -50, y: -500, w: 100, h: 1000 })], 800, 600)
	assert.ok(portrait)
	close(portrait.zoom, 0.48)
	close(portrait.x, 400)
	close(portrait.y, 300)

	const landscape = fitViewport([shape({ x: -500, y: -50, w: 1000, h: 100 })], 800, 600)
	assert.ok(landscape)
	close(landscape.zoom, 0.64)
	close(landscape.x, 400)
	close(landscape.y, 300)
})

test('centers single points and tiny shapes without exceeding 1.5 zoom', () => {
	const point = fitViewport([shape({ x: -20, y: 35, w: 0, h: 0 })], 800, 600)
	assert.ok(point)
	close(point.zoom, 1.5)
	close(point.x, 430)
	close(point.y, 247.5)

	const tiny = fitViewport([shape({ x: 10, y: -10, w: 1e-300, h: 1e-300 })], 800, 600)
	assert.ok(tiny)
	close(tiny.zoom, 1.5)
	close(tiny.x, 400 - 10 * 1.5)
	close(tiny.y, 300 - -10 * 1.5)
})

test('initial fit includes manually routed connectors beyond object bounds', () => {
	const from = shape({ id: 'a', w: 200, h: 500 })
	const to = shape({ id: 'b', x: 400, w: 200, h: 500 })
	const connector = {
		id: 'c',
		type: 'connector' as const,
		from: 'a',
		to: 'b',
		color: '#000000',
		fromAnchor: 0,
		toAnchor: 0,
	}
	const result = fitViewport([from, to, connector], 800, 600)
	assert.ok(result)
	const { start, end } = getConnectorAnchors(from, to, 0, 0)
	const route = getConnectorRoute(from, to, start, end, 0, 0)
	assert.ok(route.some((point) => point.y < 0))
	for (const point of route) {
		assert.ok(result.x + point.x * result.zoom >= 80 - 1e-8)
		assert.ok(result.x + point.x * result.zoom <= 720 + 1e-8)
		assert.ok(result.y + point.y * result.zoom >= 60 - 1e-8)
		assert.ok(result.y + point.y * result.zoom <= 540 + 1e-8)
	}
})

test('returns null for empty boards, connectors, unusable containers, and non-finite shapes', () => {
	assert.equal(fitViewport([], 800, 600), null)
	assert.equal(
		fitViewport([{ id: 'c', type: 'connector', from: 'a', to: 'b', color: '#000' }], 800, 600),
		null,
	)
	assert.equal(fitViewport([shape()], 0, 600), null)
	assert.equal(fitViewport([shape()], 800, Number.NaN), null)
	assert.equal(fitViewport([shape()], 800, Number.POSITIVE_INFINITY), null)

	const badShapes: Shape[] = [
		shape({ x: Number.NaN }),
		shape({ y: Number.POSITIVE_INFINITY }),
		shape({ w: Number.NEGATIVE_INFINITY }),
	]
	assert.equal(fitViewport(badShapes, 800, 600), null)

	assert.equal(fitViewport([shape({ x: 1e308, w: 1e308 })], 800, 600), null)
})
