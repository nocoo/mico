import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	computeGrid,
	GRID_FADE,
	GRID_FINE_WORLD,
	GRID_MAJOR_WORLD,
	GRID_MID_WORLD,
	gridPathData,
	positiveModulo,
} from './grid.ts'

const view = (x: number, y: number, zoom: number) => ({ x, y, zoom })

test('grid keeps the 64/32/8 world hierarchy at unit zoom', () => {
	const metrics = computeGrid(view(0, 0, 1))
	assert.equal(GRID_MAJOR_WORLD, 64)
	assert.equal(GRID_MID_WORLD, 32)
	assert.equal(GRID_FINE_WORLD, 8)
	assert.equal(metrics.tile, 64)
	assert.deepEqual(metrics.spacing, { major: 64, mid: 32, fine: 8 })
	assert.equal(metrics.midOffset, 32)
	assert.deepEqual(metrics.fineOffsets, [8, 16, 24, 40, 48, 56])
})

test('fine divisions skip the major and midpoint lines of every major cell', () => {
	const metrics = computeGrid(view(0, 0, 1))
	for (const offset of metrics.fineOffsets) {
		assert.ok(offset > 0 && offset < metrics.tile)
		assert.notEqual(offset % metrics.midOffset, 0)
		assert.equal(offset % 8, 0)
	}
	assert.equal(metrics.fineOffsets.length, 6)
})

test('grid spacing scales with zoom', () => {
	const metrics = computeGrid(view(0, 0, 2))
	assert.equal(metrics.tile, 128)
	assert.deepEqual(metrics.spacing, { major: 128, mid: 64, fine: 16 })
	assert.equal(metrics.midOffset, 64)
	assert.deepEqual(metrics.fineOffsets, [16, 32, 48, 80, 96, 112])

	const half = computeGrid(view(0, 0, 0.5))
	assert.equal(half.tile, 32)
	assert.equal(half.midOffset, 16)
	assert.deepEqual(half.fineOffsets, [4, 8, 12, 20, 24, 28])
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

test('dense detail fades out at low zoom while the major grid stays readable', () => {
	const full = computeGrid(view(0, 0, 1))
	assert.deepEqual(full.detail, { major: 1, mid: 1, fine: 1 })

	const half = computeGrid(view(0, 0, 0.5))
	assert.equal(half.detail.fine, 0)
	assert.equal(half.detail.mid, 0.5)
	assert.equal(half.detail.major, 1)

	const quarter = computeGrid(view(0, 0, 0.25))
	assert.equal(quarter.detail.fine, 0)
	assert.equal(quarter.detail.mid, 0)
	assert.ok(quarter.detail.major > GRID_FADE.majorMin)
	assert.ok(quarter.detail.major < 1)

	const tiny = computeGrid(view(0, 0, 0.05))
	assert.equal(tiny.detail.fine, 0)
	assert.equal(tiny.detail.mid, 0)
	assert.equal(tiny.detail.major, GRID_FADE.majorMin)
})

test('detail opacity ramps monotonically as zoom grows', () => {
	let previous = -1
	for (const zoom of [0.05, 0.1, 0.25, 0.5, 0.75, 1, 2, 3]) {
		const detail = computeGrid(view(0, 0, zoom)).detail
		assert.ok(detail.fine >= previous || detail.fine === 0)
		assert.ok(detail.mid >= detail.fine)
		assert.ok(detail.major >= detail.mid)
		previous = detail.fine
	}
})

test('path data draws major, dashed midpoint and fine lines inside one tile', () => {
	const metrics = computeGrid(view(0, 0, 1))
	const paths = gridPathData(metrics)
	assert.equal(paths.major, 'M0 0V64M64 0V64M0 0H64M0 64H64')
	assert.equal(paths.mid, 'M32 0V64M0 32H64')
	assert.equal(paths.fine.split('M').length - 1, 12)
	for (const offset of metrics.fineOffsets) {
		assert.ok(paths.fine.includes(`M${offset} 0V64`))
		assert.ok(paths.fine.includes(`M0 ${offset}H64`))
	}
	assert.ok(!paths.fine.includes('M32 0V64'))
	assert.ok(!paths.fine.includes('M0 32H64'))
})

test('invalid viewports are rejected explicitly', () => {
	assert.throws(() => computeGrid(view(Number.NaN, 0, 1)), /finite/)
	assert.throws(() => computeGrid(view(0, Number.POSITIVE_INFINITY, 1)), /finite/)
	assert.throws(() => computeGrid(view(0, 0, Number.NaN)), /finite/)
	assert.throws(() => computeGrid(view(0, 0, 0)), /greater than zero/)
	assert.throws(() => computeGrid(view(0, 0, -1)), /greater than zero/)
	assert.throws(() => computeGrid(undefined as never), /finite/)
})
