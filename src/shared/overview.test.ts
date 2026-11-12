import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractOverviewBlocks, overviewProjection, projectOverviewBlocks } from './overview.ts'
import type { Shape } from './types.ts'

const shape = (type: Shape['type'], id: string, values: Record<string, unknown> = {}): Shape =>
	({ id, type, x: 0, y: 0, w: 100, h: 80, color: '#00a2e1', ...values }) as Shape

test('overview extraction keeps only block silhouettes and puts frames behind them', () => {
	const note = shape('note', 'note', { text: 'private note text' })
	const frame = shape('frame', 'frame', { title: 'frame title', backgroundImageId: 'asset-id' })
	const blocks = extractOverviewBlocks([
		note,
		shape('text', 'text', { text: 'standalone text' }),
		shape('line', 'line'),
		shape('path', 'path', {
			points: [
				{ x: 0, y: 0 },
				{ x: 5, y: 5 },
			],
		}),
		shape('connector', 'edge', { from: 'note', to: 'frame' }),
		frame,
		shape('image', 'image', { imageId: 'secret-image-id' }),
	])

	assert.deepEqual(
		blocks.map(({ type }) => type),
		['frame', 'note', 'image'],
	)
	assert.equal(Object.hasOwn(blocks[0], 'title'), false)
	assert.equal(Object.hasOwn(blocks[1], 'text'), false)
	assert.doesNotMatch(JSON.stringify(blocks), /private|asset-id|secret-image|standalone/)
})

test('overview geometry normalizes signed dimensions and ignores invalid values', () => {
	const blocks = extractOverviewBlocks([
		shape('rectangle', 'signed', { x: 50, y: 30, w: -70, h: -20 }),
		shape('ellipse', 'invalid', { x: Number.NaN }),
	])
	assert.deepEqual(
		blocks[0] && { x: blocks[0].x, y: blocks[0].y, w: blocks[0].w, h: blocks[0].h },
		{
			x: -20,
			y: 10,
			w: 70,
			h: 20,
		},
	)
	assert.equal(blocks.length, 1)
})

test('overview projection is finite for empty and extreme boards', () => {
	for (const projection of [
		overviewProjection([]),
		projectOverviewBlocks([
			{ id: 'far', type: 'note', x: 1e308, y: 1e308, w: 0, h: 0, color: '#fff' },
		]),
		projectOverviewBlocks([
			{ id: 'extreme', type: 'frame', x: -1e308, y: -1e308, w: 1e308, h: 1e308, color: '#fff' },
		]),
	]) {
		assert.ok(Object.values(projection.bounds).every(Number.isFinite))
		assert.ok(Number.isFinite(projection.scale))
		assert.ok(Number.isFinite(projection.offsetX))
		assert.ok(Number.isFinite(projection.offsetY))
		for (const block of projection.blocks) {
			assert.ok(
				Object.values(block)
					.filter((value) => typeof value === 'number')
					.every(Number.isFinite),
			)
			assert.ok(
				block.projectedX >= 0 && block.projectedX + block.projectedWidth <= projection.width,
			)
			assert.ok(
				block.projectedY >= 0 && block.projectedY + block.projectedHeight <= projection.height,
			)
		}
	}
})

test('overview output stays bounded', () => {
	const shapes = Array.from({ length: 300 }, (_, index) => shape('rectangle', String(index)))
	assert.equal(overviewProjection(shapes).blocks.length, 240)
})
