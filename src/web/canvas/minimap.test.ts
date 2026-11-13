import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { OverviewProjection } from '../../shared/overview.ts'
import {
	canvasViewportRect,
	overviewPointToWorld,
	projectOverviewRect,
	viewportCenteredOn,
} from '../../shared/overview.ts'
import { viewportAfterOverviewDrag } from './minimap.ts'

const projection: OverviewProjection = {
	width: 176,
	height: 116,
	bounds: { left: -100, top: -50, right: 100, bottom: 50 },
	scale: 0.5,
	offsetX: 88,
	offsetY: 58,
	blocks: [],
}

test('minimap points map back to world coordinates', () => {
	assert.deepEqual(overviewPointToWorld(projection, 38, 33), { x: -100, y: -50 })
	assert.deepEqual(overviewPointToWorld(projection, 138, 83), { x: 100, y: 50 })
})

test('minimap navigation centers the visible canvas within reserved assistant width', () => {
	const viewport = viewportCenteredOn(
		{ x: 12, y: 34, zoom: 2 },
		{ width: 1200, height: 800, rightInset: 376 },
		{ x: 200, y: -40 },
	)
	assert.deepEqual(viewport, { x: 12, y: 480, zoom: 2 })
	assert.deepEqual(canvasViewportRect(viewport, { width: 1200, height: 800, rightInset: 376 }), {
		left: -6,
		top: -240,
		right: 406,
		bottom: 160,
	})
})

test('minimap drag moves the starting viewport by the pointer displacement', () => {
	assert.deepEqual(
		viewportAfterOverviewDrag(
			projection,
			{ x: 100, y: 60, zoom: 2 },
			{ width: 1200, height: 800, rightInset: 200 },
			{ x: 20, y: 30 },
			{ x: 40, y: 60 },
		),
		{ x: 20, y: -60, zoom: 2 },
	)
})

test('viewport outline projection clamps to finite minimap bounds', () => {
	const projected = projectOverviewRect(projection, {
		left: -1000,
		top: -1000,
		right: 1000,
		bottom: 1000,
	})
	assert.deepEqual(projected, { left: 0, top: 0, right: 176, bottom: 116 })
})
