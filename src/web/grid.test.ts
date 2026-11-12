import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	computeGrid,
	GRID_MAX_SCREEN,
	GRID_MIN_SCREEN,
	GRID_SNAP_WORLD,
	GRID_WORLD,
} from './grid.ts'

const view = (x: number, y: number, zoom: number) => ({ x, y, zoom })

const close = (actual: number, expected: number) => {
	assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}

test('visual grid is 24 world units while snapping stays on 16 world units', () => {
	assert.equal(GRID_WORLD, 24)
	assert.equal(GRID_SNAP_WORLD, 16)
	assert.deepEqual(computeGrid(view(0, 0, 1)), { spacing: 24, offsetX: 0, offsetY: 0 })
})

test('visual grid doubles at low zoom to remain legible', () => {
	close(computeGrid(view(0, 0, 0.75)).spacing, 18)
	close(computeGrid(view(0, 0, 0.5)).spacing, 24)
	close(computeGrid(view(0, 0, 0.25)).spacing, 24)
	close(computeGrid(view(0, 0, 0.05)).spacing, 19.2)
})

test('visual grid halves at high zoom to remain bounded', () => {
	close(computeGrid(view(0, 0, 2)).spacing, 48)
	close(computeGrid(view(0, 0, 3)).spacing, 36)
	close(computeGrid(view(0, 0, 6)).spacing, 36)
})

test('adaptive spacing stays inside the reference screen-space bounds', () => {
	for (const zoom of [0.0001, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 10, 100]) {
		const { spacing } = computeGrid(view(0, 0, zoom))
		assert.ok(spacing >= GRID_MIN_SCREEN)
		assert.ok(spacing <= GRID_MAX_SCREEN)
	}
})

test('grid offsets track the exact viewport pan', () => {
	assert.deepEqual(computeGrid(view(-200, 40, 0.25)), {
		spacing: 24,
		offsetX: -200,
		offsetY: 40,
	})
	assert.deepEqual(computeGrid(view(28, -58, 1)), {
		spacing: 24,
		offsetX: 28,
		offsetY: -58,
	})
})

test('invalid viewports are rejected explicitly', () => {
	assert.throws(() => computeGrid(view(Number.NaN, 0, 1)), /finite/)
	assert.throws(() => computeGrid(view(0, Number.POSITIVE_INFINITY, 1)), /finite/)
	assert.throws(() => computeGrid(view(0, 0, Number.NaN)), /finite/)
	assert.throws(() => computeGrid(view(0, 0, Number.POSITIVE_INFINITY)), /finite/)
	assert.throws(() => computeGrid(view(0, 0, 0)), /greater than zero/)
	assert.throws(() => computeGrid(view(0, 0, -1)), /greater than zero/)
	assert.throws(() => computeGrid(undefined as never), /finite/)
})
