import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Shape } from '../shared/types.ts'
import { fitViewport } from './viewport.ts'

const box: Shape = {
	id: 'box',
	type: 'rectangle',
	x: 1800,
	y: 80,
	w: 1200,
	h: 800,
	color: '#5b5fc7',
}

test('fit centers large offscreen boards inside the toolbar margins', () => {
	const view = fitViewport([box], 1040, 800)
	assert.equal(view.zoom, 0.8)
	assert.equal(view.x + box.x * view.zoom, 40)
	assert.equal(view.y + box.y * view.zoom, 80)
	assert.equal(view.x + (box.x + box.w) * view.zoom, 1000)
	assert.equal(view.y + (box.y + box.h) * view.zoom, 720)
})

test('fit includes signed lines, ignores connectors, and handles empty or tiny boards', () => {
	const line: Shape = { ...box, type: 'line', x: 100, y: 200, w: -300, h: -400 }
	const edge: Shape = { id: 'edge', type: 'connector', from: 'a', to: 'b', color: '#5b5fc7' }
	assert.deepEqual(fitViewport([], 1000, 800), { x: 0, y: 0, zoom: 1 })
	assert.deepEqual(fitViewport([edge], 1000, 800), { x: 0, y: 0, zoom: 1 })
	assert.deepEqual(fitViewport([line, edge], 1000, 800), { x: 550, y: 400, zoom: 1 })
	assert.deepEqual(fitViewport([{ ...box, w: 0, h: 0 }], 1000, 800), {
		x: -1300,
		y: 320,
		zoom: 1,
	})
	assert.ok(fitViewport([box], 1, 1).zoom > 0)
})
