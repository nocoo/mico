import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import type { Shape } from '../shared/types.ts'
import { canvasPreview, PREVIEW_HEIGHT, PREVIEW_WIDTH } from './preview.ts'

function decode(preview: string): string {
	assert.match(preview, /^data:image\/svg\+xml;base64,/)
	return Buffer.from(preview.split(',')[1], 'base64').toString('utf8')
}

const rect: Shape = {
	id: 'a',
	type: 'rectangle',
	x: 100,
	y: 100,
	w: 200,
	h: 80,
	color: '#00a2e1',
	text: 'Gateway',
}
const note: Shape = {
	id: 'n',
	type: 'note',
	x: 400,
	y: 100,
	w: 120,
	h: 120,
	color: '#fff8d4',
	text: 'Idea',
}
const edge: Shape = { id: 'e', type: 'connector', from: 'a', to: 'n', color: '#3c7e9c' }

test('an empty canvas produces a framed placeholder preview', () => {
	const svg = decode(canvasPreview([]))
	assert.match(svg, new RegExp(`width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}"`))
	assert.match(svg, /fill="#f5fafc"/)
	assert.doesNotMatch(svg, /<text|<ellipse|<line/)
})

test('block silhouettes render inside the preview bounds without content or connectors', () => {
	const svg = decode(canvasPreview([rect, note, edge]))
	assert.match(svg, /fill="#00a2e1"/)
	assert.match(svg, /fill="#fff8d4"/)
	assert.doesNotMatch(svg, /<line|<text|Gateway|Idea/)
	for (const match of svg.matchAll(
		/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g,
	)) {
		const [x, y, width, height] = match.slice(1).map(Number)
		assert.ok(x >= 0 && x <= PREVIEW_WIDTH, `x ${x}`)
		assert.ok(y >= 0 && y <= PREVIEW_HEIGHT, `y ${y}`)
		assert.ok(x + width <= PREVIEW_WIDTH + 0.5, `right ${x + width}`)
		assert.ok(y + height <= PREVIEW_HEIGHT + 0.5, `bottom ${y + height}`)
	}
})

test('frame previews use the lighter fill and render before other blocks', () => {
	for (const color of ['#00a2e1', '#a6d94f', '#f7de4b', '#ff7fa3', '#2b3038', '#123456']) {
		const svg = decode(
			canvasPreview([rect, { id: 'frame', type: 'frame', x: 0, y: 0, w: 200, h: 120, color }]),
		)
		assert.ok(svg.includes(`fill="${color}" fill-opacity="0.05"`))
		const silhouettes = svg.match(/<rect [^>]+fill-opacity="[^"]+"[^>]*\/>/g) ?? []
		assert.match(silhouettes[0] ?? '', new RegExp(`fill="${color}" fill-opacity="0.05"`))
	}
})

test('large boards stay bounded while standalone text does not affect them', () => {
	const ignored: Shape = {
		id: 'huge-text',
		type: 'text',
		x: 10_000,
		y: 10_000,
		w: 4_000,
		h: 2_000,
		color: '#00a2e1',
		text: '<script>&"danger"</script>',
		fontSize: 48,
	}
	const svg = decode(canvasPreview([ignored, rect]))
	assert.doesNotMatch(svg, /<script>|danger|<text/)
	for (const match of svg.matchAll(
		/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g,
	)) {
		const [x, y, width, height] = match.slice(1).map(Number)
		assert.ok(x >= -0.5 && x <= PREVIEW_WIDTH)
		assert.ok(y >= -0.5 && y <= PREVIEW_HEIGHT)
		assert.ok(x + width <= PREVIEW_WIDTH + 0.5)
		assert.ok(y + height <= PREVIEW_HEIGHT + 0.5)
	}
})

test('image elements use a silhouette without embedding asset data', () => {
	const image: Shape = {
		id: 'image',
		type: 'image',
		x: 0,
		y: 0,
		w: 200,
		h: 100,
		color: '#00a2e1',
		imageId: 'asset-id',
		text: 'private image caption',
	}
	const svg = decode(canvasPreview([image]))
	assert.match(svg, /<rect /)
	assert.doesNotMatch(svg, /asset-id|private image caption|<image|<path/)
})

test('lines and paths contribute neither artwork nor bounds', () => {
	const line: Shape = {
		id: 'line',
		type: 'line',
		x: -100_000,
		y: -100_000,
		w: 200_000,
		h: 200_000,
		color: '#5c8c1e',
	}
	const path: Shape = {
		id: 'path',
		type: 'path',
		x: -100_000,
		y: -100_000,
		w: 200_000,
		h: 200_000,
		color: '#b23f63',
		brush: 'brush',
		strokeWidth: 4,
		points: Array.from({ length: 500 }, (_, index) => ({ x: index, y: index })),
	}
	const svg = decode(canvasPreview([line, path, note]))
	assert.doesNotMatch(svg, /<line|<path/)
	assert.match(svg, /fill="#fff8d4"/)
})

test('malicious colors are escaped and preview output is bounded', () => {
	const shapes = Array.from(
		{ length: 500 },
		(_, index): Shape => ({
			...rect,
			id: String(index),
			color: index === 0 ? '"><script>\u0001' : rect.color,
		}),
	)
	const svg = decode(canvasPreview(shapes))
	assert.doesNotMatch(svg, /<script>/)
	assert.equal(svg.includes('\u0001'), false)
	const fills = svg.match(/fill="#00a2e1"/g) ?? []
	assert.ok(fills.length > 0 && fills.length <= 240)
	assert.match(svg, /&quot;&gt;&lt;script&gt;/)
})
