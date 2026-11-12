import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Shape } from '../shared/types.ts'
import { fitViewport, panelViewportInset } from './viewport.ts'

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

test('assistant inset follows desktop and full-width mobile panel layouts', () => {
	assert.equal(panelViewportInset(1040, 376, 348, 14), 376)
	assert.equal(panelViewportInset(760, 376, 732, 14), 0)
	assert.equal(panelViewportInset(761, 376, 348, 14), 376)
})

test('fit centers boards in the unobscured canvas beside the desktop assistant', () => {
	const view = fitViewport([box], 1040, 800, { right: 376 })
	assert.equal(view.zoom, 584 / 1200)
	assert.equal(view.x + box.x * view.zoom, 40)
	assert.equal(view.x + (box.x + box.w) * view.zoom, 624)
	assert.equal(view.y + (box.y + box.h / 2) * view.zoom, 400)
})

test('fit keeps the closed-panel viewport unchanged', () => {
	assert.deepEqual(fitViewport([box], 1040, 800, { right: 0 }), fitViewport([box], 1040, 800))
})

test('fit includes exact connector curve extrema and arrow bounds', () => {
	const from: Shape = { ...box, id: 'from', x: 0, y: 0, w: 200, h: 80 }
	const to: Shape = { ...box, id: 'to', x: 1000, y: 0, w: 200, h: 80 }
	const edge: Shape = {
		id: 'edge',
		type: 'connector',
		from: 'from',
		to: 'to',
		fromAnchor: 0,
		toAnchor: 0,
		color: '#5b5fc7',
	}
	const view = fitViewport([from, to, edge], 1280, 720)
	const t = (1000 - Math.sqrt(982000)) / 18
	const inverse = 1 - t
	const curveTop =
		inverse ** 3 * -4 + 3 * inverse ** 2 * t * -504 + 3 * inverse * t ** 2 * -504 + t ** 3 * -13

	assert.equal(view.zoom, 1)
	assert.equal(view.x, 40)
	assert.ok(Math.abs(view.y - (360 - (curveTop + 80) / 2)) < 1e-9)
	assert.ok(view.y + curveTop * view.zoom >= 80)
	assert.ok(view.y + from.h * view.zoom <= 720 - 80)
})

test('fit includes signed lines, ignores invalid or unresolved connectors, and handles tiny boards', () => {
	const line: Shape = { ...box, type: 'line', x: 100, y: 200, w: -300, h: -400 }
	const edge: Shape = { id: 'edge', type: 'connector', from: 'a', to: 'b', color: '#5b5fc7' }
	const invalid: Shape = { ...edge, id: 'invalid', from: 'box', to: 'box', fromAnchor: 12 }
	assert.deepEqual(fitViewport([], 1000, 800), { x: 0, y: 0, zoom: 1 })
	assert.deepEqual(fitViewport([edge], 1000, 800), { x: 0, y: 0, zoom: 1 })
	assert.deepEqual(fitViewport([line, edge], 1000, 800), { x: 550, y: 400, zoom: 1 })
	assert.deepEqual(fitViewport([box, invalid], 1000, 800), fitViewport([box], 1000, 800))
	assert.deepEqual(fitViewport([{ ...box, w: 0, h: 0 }], 1000, 800), {
		x: -1300,
		y: 320,
		zoom: 1,
	})
	assert.ok(fitViewport([box], 1, 1).zoom > 0)
})
