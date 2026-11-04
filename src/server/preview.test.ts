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

test('shapes, connectors and labels render inside the preview bounds', () => {
	const svg = decode(canvasPreview([rect, note, edge]))
	assert.match(svg, /width="160" height="100"/)
	assert.match(svg, /fill="#00a2e1"/)
	assert.match(svg, /fill="#fff8d4"/)
	assert.match(svg, /<line /)
	assert.match(svg, /Gateway/)
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

test('large boards are scaled into the preview and text is escaped', () => {
	const huge: Shape = {
		id: 'huge',
		type: 'text',
		x: 10_000,
		y: 10_000,
		w: 4_000,
		h: 2_000,
		color: '#00a2e1',
		text: '<script>&"danger"</script>',
		fontSize: 48,
	}
	const svg = decode(canvasPreview([huge]))
	assert.doesNotMatch(svg, /<script>/)
	assert.match(svg, /&lt;script&gt;&amp;&quot;danger&quot;&lt;\/script&gt;/)
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

test('signed lines keep their true direction in the preview', () => {
	const line: Shape = {
		id: 'signed-line',
		type: 'line',
		x: 100,
		y: 100,
		w: -80,
		h: -40,
		color: '#5c8c1e',
	}
	const svg = decode(canvasPreview([line]))
	const match = svg.match(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/)
	assert.ok(match)
	const [x1, y1, x2, y2] = match.slice(1).map(Number)
	assert.ok(x2 < x1)
	assert.ok(y2 < y1)
})

test('control characters are stripped and long paths are sampled', () => {
	const text: Shape = {
		id: 'control-text',
		type: 'text',
		x: 0,
		y: 0,
		w: 120,
		h: 40,
		color: '#0b7ba8',
		text: 'before\u0001after',
		fontSize: 16,
	}
	const path: Shape = {
		id: 'long-path',
		type: 'path',
		x: 0,
		y: 0,
		w: 400,
		h: 200,
		color: '#b23f63',
		brush: 'brush',
		strokeWidth: 4,
		points: Array.from({ length: 500 }, (_, index) => ({
			x: (index * 400) / 499,
			y: (index % 2) * 200,
		})),
	}
	const svg = decode(canvasPreview([text, path]))
	assert.ok(!svg.includes('\u0001'))
	assert.match(svg, /beforeafter/)
	const pathMatch = svg.match(/<path d="([^"]+)"/)
	assert.ok(pathMatch)
	const commands = pathMatch[1].split(/[ML]/).filter((part) => part.trim().length > 0)
	assert.ok(commands.length <= 65)
	assert.ok(commands.length >= 2)
})
