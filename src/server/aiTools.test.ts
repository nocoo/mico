import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCanvasTools, estimateHtmlCardHeight, selectToolsForTurn } from './aiTools.ts'
import type { ImageGenerationService } from './imageGeneration.ts'
import { BoardStore, LOCAL_TENANT, OperationError, type TenantStore } from './store.ts'

async function withStore(run: (store: TenantStore) => Promise<void>) {
	const directory = mkdtempSync(join(tmpdir(), 'mico-aitools-'))
	const board = new BoardStore(join(directory, 'board.sqlite'))
	const store = board.forTenant(LOCAL_TENANT)
	try {
		await run(store)
	} finally {
		await board.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

const run = (tool: unknown, input: unknown) =>
	(tool as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute(input, {
		toolCallId: 'test-call',
		messages: [],
	})

test('estimateHtmlCardHeight measures grids, tiles, panels, tables, svgs and plain fallbacks', () => {
	const rich = `
		<style>.hidden { display: none }</style>
		<script>console.log('ignored')</script>
		<main class="mico-report">
			<div class="mico-eyebrow">Session Overview</div>
			<h1>Architecture Review &amp; Next Steps</h1>
			<div class="mico-tiles">
				<div class="mico-tile">A</div>
				<div class="mico-tile">B</div>
				<div class="mico-tile">C</div>
				<div class="mico-tile">D</div>
			</div>
			<div class="mico-grid">
				<section class="mico-panel mico-full">
					<h2>Key Risks</h2>
					<ul><li>Latency spike under peak load</li></ul>
					<div class="mico-kv"><span>Owner</span><span>Platform</span></div>
					<p>Mitigation rolled out to canary.</p>
					<small>Updated today</small>
				</section>
				<section class="mico-panel">
					<table><tr><th>Metric</th><th>Value</th></tr><tr><td>P99</td><td>42ms</td></tr></table>
				</section>
				<div class="mico-callout">Follow-up pending</div>
			</div>
			<div class="mico-grid-3">
				<div class="mico-panel"><p>Col 1</p></div>
				<div class="mico-panel"><p>Col 2</p></div>
			</div>
			<section class="mico-hero"><p>Hero summary</p></section>
			<table><tr><td>Standalone row</td></tr></table>
			<p>Standalone note</p>
			<li>Standalone item</li>
			<svg viewBox="0 0 400 220"></svg>
		</main>
	`
	const richHeight = estimateHtmlCardHeight(rich, 760)
	assert.ok(richHeight >= 400 && richHeight <= 1600)
	assert.equal(richHeight % 8, 0)

	const plain = estimateHtmlCardHeight('<svg height="120"></svg><div>Fallback summary</div>', 400)
	assert.ok(plain >= 160 && plain <= 1600)

	const minimal = estimateHtmlCardHeight('Short plain text')
	assert.equal(minimal, 160)
})

test('createCanvasTools exercises primitives, frames, strokes, html cards, updates and deletions', async () => {
	await withStore(async (store) => {
		const broadcasts: unknown[] = []
		const canvasId = await store.getActiveCanvasId()
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		const assetId = await store.saveImage(png, 'image/png')

		const fakeImageGeneration = {
			start: async (req: { shapeId?: string }) => {
				if (req.shapeId === 'busy') {
					throw new OperationError(409, 'IMAGE_GENERATION_BUSY', 'Already generating')
				}
				return {
					ok: true as const,
					status: 'pending' as const,
					jobId: 'job-1',
					shapeId: req.shapeId ?? 'gen-1',
					canvasId,
				}
			},
			status: async (jobId?: string) => ({ ok: true, status: 'pending', jobId: jobId ?? 'job-1' }),
		} as unknown as ImageGenerationService

		const tools = await createCanvasTools({
			store,
			broadcast: (event) => broadcasts.push(event),
			selection: [],
			canvasId,
			imageGeneration: fakeImageGeneration,
		})

		const badHtmlRead = (await run(tools.get_board, { include_html: true })) as {
			ok: boolean
			error?: string
		}
		assert.equal(badHtmlRead.ok, false)
		assert.equal(badHtmlRead.error, 'INVALID_REQUEST')

		const texts = (await run(tools.add_texts, {
			texts: [
				{ id: 't-cjk', x: 80, y: 140, text: '中文标题\n第二行', font: 'serif', fontWeight: 700 },
				{ id: 't-fixed', x: 80, y: 240, w: 200, h: 40, text: 'Fixed', fontSize: 18 },
			],
		})) as { ok: boolean; created: Array<{ id: string; w: number; h: number }> }
		assert.equal(texts.ok, true)
		assert.equal(texts.created.length, 2)
		assert.ok(texts.created[0].w > 48 && texts.created[0].h > 40)

		const boxes = (await run(tools.add_boxes, {
			boxes: [
				{ id: 'b1', kind: 'rectangle', x: 100, y: 320, w: 200, h: 90, text: 'Step 1' },
				{ id: 'b2', kind: 'ellipse', x: 420, y: 320, w: 180, h: 90, text: 'State A' },
			],
		})) as { ok: boolean }
		assert.equal(boxes.ok, true)

		const lines = (await run(tools.add_lines, {
			lines: [{ id: 'l1', from: { x: 100, y: 500 }, to: { x: 500, y: 500 } }],
		})) as { ok: boolean }
		assert.equal(lines.ok, true)

		const connectors = (await run(tools.add_connectors, {
			connectors: [{ id: 'c1', from: 'b1', to: 'b2', fromAnchor: 1, toAnchor: 3 }],
		})) as { ok: boolean }
		assert.equal(connectors.ok, true)

		const strokes = (await run(tools.add_strokes, {
			strokes: [
				{
					id: 's1',
					points: [
						{ x: 10.123, y: 20.456 },
						{ x: 50.789, y: 80.111 },
					],
					brush: 'marker',
					strokeWidth: 6,
				},
			],
		})) as { ok: boolean; created: Array<{ x: number; y: number; w: number; h: number }> }
		assert.equal(strokes.ok, true)
		assert.equal(strokes.created[0].x, 10.1)
		assert.equal(strokes.created[0].y, 20.5)

		const images = (await run(tools.add_images, {
			images: [{ id: 'img1', imageId: assetId, x: 700, y: 320, w: 160, h: 120 }],
		})) as { ok: boolean }
		assert.equal(images.ok, true)

		const htmlCards = (await run(tools.add_html_cards, {
			cards: [
				{
					id: 'card1',
					x: 1000,
					y: 140,
					title: 'Summary Card',
					html: '<main class="mico-report"><h1><i data-lucide="activity"></i>Status</h1><p>Healthy</p></main>',
				},
			],
		})) as { ok: boolean; created: Array<{ h: number }> }
		assert.equal(htmlCards.ok, true)
		assert.ok(htmlCards.created[0].h >= 160)

		const duplicateFrameMember = (await run(tools.add_frames, {
			frames: [{ id: 'f-bad', title: 'Bad', memberIds: ['b1', 'b1'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(duplicateFrameMember.ok, false)
		assert.equal(duplicateFrameMember.error, 'INVALID_REQUEST')

		const missingMember = (await run(tools.add_frames, {
			frames: [{ id: 'f-missing', title: 'Missing', memberIds: ['b1', 'does-not-exist'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(missingMember.ok, false)
		assert.equal(missingMember.error, 'NOT_FOUND')

		const connectorMember = (await run(tools.add_frames, {
			frames: [{ id: 'f-conn', title: 'Conn', memberIds: ['b1', 'c1'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(connectorMember.ok, false)
		assert.equal(connectorMember.error, 'INVALID_REQUEST')

		const collidingFrame = (await run(tools.add_frames, {
			frames: [{ id: 'f-collide', title: 'Collide', memberIds: ['b1', 'img1'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(collidingFrame.ok, false)
		assert.equal(collidingFrame.error, 'FRAME_COLLISION')

		const validFrame = (await run(tools.add_frames, {
			frames: [
				{
					id: 'f1',
					title: 'Pipeline',
					memberIds: ['b1', 'b2'],
					backgroundImageId: 'img1',
					backgroundFit: 'contain',
				},
			],
		})) as { ok: boolean; created: Array<{ id: string }> }
		assert.equal(validFrame.ok, true)
		assert.equal(validFrame.created[0].id, 'f1')

		const alreadyFramed = (await run(tools.add_frames, {
			frames: [{ id: 'f2', title: 'Already', memberIds: ['b1', 'l1'] }],
		})) as { ok: boolean; error?: string }
		assert.equal(alreadyFramed.ok, false)
		assert.equal(alreadyFramed.error, 'FRAME_MEMBER')

		const updated = (await run(tools.update_shapes, {
			updates: [
				{
					id: 'card1',
					patch: {
						html: '<main class="mico-report"><h1>Updated</h1><p>Line 1</p><p>Line 2</p></main>',
					},
				},
			],
		})) as { ok: boolean; updated: Array<{ id: string }> }
		assert.equal(updated.ok, true)
		assert.equal(updated.updated[0].id, 'card1')

		const deleted = (await run(tools.delete_shapes, { ids: ['s1'] })) as {
			ok: boolean
			deleted: string[]
		}
		assert.equal(deleted.ok, true)
		assert.deepEqual(deleted.deleted, ['s1'])

		const genOk = (await run(tools.generate_image, {
			prompt: 'diagram',
			aspect: '1:1',
			x: 0,
			y: 900,
			width: 240,
			shapeId: 'gen-ok',
		})) as { ok: boolean; jobId: string }
		assert.equal(genOk.ok, true)
		assert.equal(genOk.jobId, 'job-1')

		const genBusy = (await run(tools.generate_image, {
			prompt: 'diagram',
			aspect: '1:1',
			x: 0,
			y: 900,
			width: 240,
			shapeId: 'busy',
		})) as { ok: boolean; error: string }
		assert.equal(genBusy.ok, false)
		assert.equal(genBusy.error, 'IMAGE_GENERATION_BUSY')

		const status = (await run(tools.image_generation_status, { jobId: 'job-1' })) as {
			ok: boolean
			jobId: string
		}
		assert.equal(status.ok, true)
		assert.equal(status.jobId, 'job-1')
		assert.ok(broadcasts.length >= 6)
	})
})

test('upsert_action_card validates missing coordinates, type conflicts and removeItemIds errors', async () => {
	await withStore(async (store) => {
		const canvasId = await store.getActiveCanvasId()
		const tools = await createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId,
		})

		await run(tools.add_boxes, {
			boxes: [{ id: 'box-1', x: 0, y: 0, w: 120, h: 60 }],
		})

		const typeConflict = (await run(tools.upsert_action_card, {
			id: 'box-1',
			title: 'Actions',
			x: 0,
			y: 0,
			items: [],
		})) as { ok: boolean; error: string }
		assert.equal(typeConflict.ok, false)
		assert.equal(typeConflict.error, 'DUPLICATE_ID')

		const missingCoords = (await run(tools.upsert_action_card, {
			id: 'act-new',
			title: 'Actions',
			items: [{ id: 'i1', text: 'Do thing' }],
		})) as { ok: boolean; error: string }
		assert.equal(missingCoords.ok, false)
		assert.equal(missingCoords.error, 'INVALID_REQUEST')

		const removeOnCreate = (await run(tools.upsert_action_card, {
			id: 'act-new',
			title: 'Actions',
			x: 20,
			y: 20,
			items: [],
			removeItemIds: ['i1'],
		})) as { ok: boolean; error: string }
		assert.equal(removeOnCreate.ok, false)
		assert.equal(removeOnCreate.error, 'INVALID_REQUEST')

		await run(tools.upsert_action_card, {
			id: 'act-1',
			title: 'Actions',
			x: 20,
			y: 20,
			items: [{ id: 'i1', text: 'First' }],
		})

		const removeMissing = (await run(tools.upsert_action_card, {
			id: 'act-1',
			title: 'Actions',
			items: [],
			removeItemIds: ['nope'],
		})) as { ok: boolean; error: string }
		assert.equal(removeMissing.ok, false)
		assert.equal(removeMissing.error, 'NOT_FOUND')

		const updateAndRemove = (await run(tools.upsert_action_card, {
			id: 'act-1',
			title: 'Actions',
			items: [{ id: 'i1', text: 'Updated' }],
			removeItemIds: ['i1'],
		})) as { ok: boolean; error: string }
		assert.equal(updateAndRemove.ok, false)
		assert.equal(updateAndRemove.error, 'INVALID_REQUEST')
	})
})

test('selectToolsForTurn filters image and stroke tools by mode and availability', async () => {
	await withStore(async (store) => {
		const tools = await createCanvasTools({
			store,
			broadcast: () => {},
			selection: [],
			canvasId: await store.getActiveCanvasId(),
		})

		const chatNoImages = selectToolsForTurn(tools, {
			mode: 'chat',
			imageGenerationAvailable: false,
			hasBoardImages: false,
		})
		assert.equal('generate_image' in chatNoImages, false)
		assert.equal('image_generation_status' in chatNoImages, false)
		assert.equal('add_strokes' in chatNoImages, true)
		assert.equal('add_images' in chatNoImages, true)

		const lectureEmptyImages = selectToolsForTurn(tools, {
			mode: 'lecture',
			imageGenerationAvailable: false,
			hasBoardImages: false,
		})
		assert.equal('add_strokes' in lectureEmptyImages, false)
		assert.equal('add_images' in lectureEmptyImages, false)

		const lectureWithImages = selectToolsForTurn(tools, {
			mode: 'lecture',
			imageGenerationAvailable: true,
			hasBoardImages: true,
		})
		assert.equal('add_strokes' in lectureWithImages, false)
		assert.equal('add_images' in lectureWithImages, true)
		assert.equal('generate_image' in lectureWithImages, true)
	})
})
