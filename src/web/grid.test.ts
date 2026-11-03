import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	computeGrid,
	GRID_FADE,
	GRID_MAJOR_WORLD,
	GRID_SNAP_WORLD,
	gridPathData,
	positiveModulo,
} from './grid.ts'

const view = (x: number, y: number, zoom: number) => ({ x, y, zoom })
const close = (actual: number, expected: number) => {
	assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}

test('grid keeps a 64 world major line and a 16 world snap step', () => {
	const metrics = computeGrid(view(0, 0, 1))
	assert.equal(GRID_MAJOR_WORLD, 64)
	assert.equal(GRID_SNAP_WORLD, 16)
	assert.equal(metrics.tile, 64)
	assert.deepEqual(metrics.spacing, { major: 64, minor: 16 })
	assert.deepEqual(metrics.minorOffsets, [16, 32, 48])
})

test('four dashed cells sit between two major lines', () => {
	const metrics = computeGrid(view(0, 0, 1))
	assert.equal(metrics.minorOffsets.length, 3)
	for (const offset of metrics.minorOffsets) {
		assert.ok(offset > 0 && offset < metrics.tile)
		assert.equal(offset % GRID_SNAP_WORLD, 0)
	}
	const cells = [0, ...metrics.minorOffsets, metrics.tile]
	for (let index = 1; index < cells.length; index += 1) {
		assert.equal(cells[index] - cells[index - 1], GRID_SNAP_WORLD)
	}
	assert.equal(cells.length - 1, 4)
})

test('grid spacing scales with zoom', () => {
	const metrics = computeGrid(view(0, 0, 2))
	assert.equal(metrics.tile, 128)
	assert.deepEqual(metrics.spacing, { major: 128, minor: 32 })
	assert.deepEqual(metrics.minorOffsets, [32, 64, 96])

	const half = computeGrid(view(0, 0, 0.5))
	assert.equal(half.tile, 32)
	assert.deepEqual(half.spacing, { major: 32, minor: 8 })
	assert.deepEqual(half.minorOffsets, [8, 16, 24])
})

test('pan offsets stay positive inside the tile for negative pans', () => {
	assert.equal(computeGrid(view(-100, -70, 1)).offsetX, 28)
	assert.equal(computeGrid(view(-100, -70, 1)).offsetY, 58)
	assert.equal(computeGrid(view(-64, -64, 1)).offsetX, 0)
	assert.equal(computeGrid(view(-65, -65, 1)).offsetX, 63)
	assert.equal(computeGrid(view(-1, -1, 1)).offsetX, 63)
	assert.equal(computeGrid(view(28, 58, 1)).offsetX, 28)
	assert.equal(positiveModulo(-64, 64), 0)
	assert.equal(positiveModulo(-100, 64), 28)
	assert.equal(positiveModulo(100, 64), 36)
})

test('grid offsets track world pan at any zoom', () => {
	const metrics = computeGrid(view(-200, 40, 0.25))
	assert.equal(metrics.tile, 16)
	assert.equal(metrics.offsetX, positiveModulo(-200, 16))
	assert.equal(metrics.offsetY, positiveModulo(40, 16))
	assert.ok(metrics.offsetX >= 0 && metrics.offsetX < metrics.tile)
	assert.ok(metrics.offsetY >= 0 && metrics.offsetY < metrics.tile)
})

test('dashed detail fades with zoom while the major line stays visible', () => {
	const full = computeGrid(view(0, 0, 1))
	assert.deepEqual(full.detail, { major: 1, minor: 1 })

	const half = computeGrid(view(0, 0, 0.5))
	assert.equal(half.detail.major, 1)
	close(half.detail.minor, 5 / 9)

	const quarter = computeGrid(view(0, 0, 0.25))
	close(quarter.detail.major, 10 / 26)
	close(quarter.detail.minor, 1 / 9)
	assert.ok(quarter.detail.major > GRID_FADE.majorMin)

	const tiny = computeGrid(view(0, 0, 0.05))
	assert.equal(tiny.detail.minor, 0)
	assert.equal(tiny.detail.major, GRID_FADE.majorMin)
	assert.ok(tiny.detail.major > 0 && tiny.detail.major <= 0.1)
})

test('detail opacity ramps monotonically as zoom grows', () => {
	let previous = -1
	for (const zoom of [0.05, 0.1, 0.25, 0.5, 0.75, 1, 2, 3]) {
		const detail = computeGrid(view(0, 0, zoom)).detail
		assert.ok(detail.minor >= previous)
		assert.ok(detail.major >= detail.minor)
		previous = detail.minor
	}
})

test('path data draws one solid major line and dashed minor lines', () => {
	const metrics = computeGrid(view(0, 0, 1))
	const paths = gridPathData(metrics)
	assert.equal(paths.major, 'M0 0V64M64 0V64M0 0H64M0 64H64')
	assert.equal(paths.minor, 'M16 0V64M0 16H64M32 0V64M0 32H64M48 0V64M0 48H64')
	assert.equal(paths.minor.split('M').length - 1, 6)
	for (const offset of metrics.minorOffsets) {
		assert.ok(paths.minor.includes(`M${offset} 0V64`))
		assert.ok(paths.minor.includes(`M0 ${offset}H64`))
	}
	assert.ok(!paths.minor.includes('M0 0V64'))
	assert.ok(!paths.minor.includes('M64 0V64'))
})

test('invalid viewports are rejected explicitly', () => {
	assert.throws(() => computeGrid(view(Number.NaN, 0, 1)), /finite/)
	assert.throws(() => computeGrid(view(0, Number.POSITIVE_INFINITY, 1)), /finite/)
	assert.throws(() => computeGrid(view(0, 0, Number.NaN)), /finite/)
	assert.throws(() => computeGrid(view(0, 0, 0)), /greater than zero/)
	assert.throws(() => computeGrid(view(0, 0, -1)), /greater than zero/)
	assert.throws(() => computeGrid(undefined as never), /finite/)
})
