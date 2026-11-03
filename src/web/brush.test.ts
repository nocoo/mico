import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Point } from '../shared/types.ts'
import { buildStroke, simplifyPoints } from './brush.ts'

const line: Point[] = [
	{ x: 0, y: 0 },
	{ x: 50, y: 0 },
	{ x: 100, y: 0 },
]

test('pencil and marker produce stroke geometry through every point', () => {
	for (const brush of ['pencil', 'marker'] as const) {
		const stroke = buildStroke(line, 4, brush)
		assert.equal(stroke.mode, 'stroke')
		assert.match(stroke.d, /^M0 0/)
		assert.equal((stroke.d.match(/M/g) ?? []).length, 1)
		assert.equal((stroke.d.match(/L/g) ?? []).length, 2)
		assert.ok(!stroke.d.includes('NaN'))
		assert.ok(stroke.d.includes('100 0'))
	}
})

test('consecutive duplicate points collapse into one segment', () => {
	const stroke = buildStroke(
		[
			{ x: 1, y: 1 },
			{ x: 1, y: 1 },
			{ x: 4, y: 5 },
		],
		2,
		'pencil',
	)
	assert.equal(stroke.d, 'M1 1L4 5')
})

test('brush strokes render a closed tapered ribbon', () => {
	const stroke = buildStroke(line, 10, 'brush')
	assert.equal(stroke.mode, 'fill')
	assert.match(stroke.d, /^M/)
	assert.match(stroke.d, /Z$/)
	assert.ok(!stroke.d.includes('NaN'))
	const numbers = stroke.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
	assert.ok(numbers.length >= 12)
	const ys = numbers.filter((_, index) => index % 2 === 1)
	const middle = Math.max(...ys.map(Math.abs))
	assert.ok(middle > 2, 'middle of the ribbon is broad')
})

test('tapered ends are narrower than the middle', () => {
	const stroke = buildStroke(line, 20, 'brush')
	const pairs = [...stroke.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({
		x: Number(match[1]),
		y: Number(match[2]),
	}))
	const extent = (x: number) =>
		Math.max(
			...pairs.filter((point) => Math.abs(point.x - x) < 0.6).map((point) => Math.abs(point.y)),
		)
	assert.ok(extent(0) < extent(50))
	assert.ok(extent(100) < extent(50))
})

test('deterministic output and input immutability', () => {
	const snapshot = structuredClone(line)
	assert.deepEqual(buildStroke(line, 6, 'brush'), buildStroke(line, 6, 'brush'))
	assert.deepEqual(line, snapshot)
})

test('invalid inputs are rejected rather than silently repaired', () => {
	assert.throws(() => buildStroke([{ x: 0, y: 0 }], 4, 'brush'), RangeError)
	assert.throws(
		() =>
			buildStroke(
				[
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
				],
				4,
				'pencil',
			),
		RangeError,
	)
	assert.throws(() => buildStroke(line, 0, 'pencil'), RangeError)
	assert.throws(() => buildStroke(line, 65, 'pencil'), RangeError)
	assert.throws(() => buildStroke(line, 4, 'spray' as never), RangeError)
	assert.throws(
		() =>
			buildStroke(
				[
					{ x: 0, y: 0 },
					{ x: Number.NaN, y: 1 },
				],
				4,
				'pencil',
			),
		RangeError,
	)
	assert.throws(() => buildStroke(null as never, 4, 'pencil'), RangeError)
})

test('simplify keeps endpoints and drops points within the threshold', () => {
	const points = [0, 1, 2, 10, 11, 30].map((x) => ({ x, y: 0 }))
	assert.deepEqual(simplifyPoints(points, 4), [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 30, y: 0 },
	])
	assert.deepEqual(simplifyPoints(points, 0), points)
	assert.deepEqual(simplifyPoints(points.slice(0, 2), 100), [
		{ x: 0, y: 0 },
		{ x: 1, y: 0 },
	])
	assert.throws(() => simplifyPoints(points, -1), RangeError)
	assert.throws(() => simplifyPoints(points, Number.NaN), RangeError)
})
