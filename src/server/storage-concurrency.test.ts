import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BoardStore, LOCAL_TENANT, MAX_CANVAS_IMAGES, OperationError } from './store.ts'

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
	'base64',
)

test('a failed generated-image revision guard rolls back its asset and board', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-image-rollback-'))
	const boards = new BoardStore(join(directory, 'board.sqlite'))
	const store = boards.forTenant(LOCAL_TENANT)
	try {
		const before = await store.getState()
		await boards.sql.exec(`
			CREATE TRIGGER reject_revision BEFORE UPDATE OF revision ON canvases
			BEGIN SELECT RAISE(IGNORE); END;
		`)
		await assert.rejects(
			store.placeGeneratedImage({
				canvasId: before.activeCanvasId,
				shapeId: 'rejected-image',
				x: 0,
				y: 0,
				w: 100,
				h: 100,
				bytes: png,
			}),
			(error: unknown) => error instanceof OperationError && error.code === 'REVISION_CONFLICT',
		)
		assert.deepEqual(await store.getState(), before)
		assert.deepEqual(await boards.sql.all('SELECT id FROM image_assets'), [])
	} finally {
		await boards.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('concurrent generated images across handles enforce the cap without orphan assets', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-image-concurrency-'))
	const path = join(directory, 'board.sqlite')
	const boards = [new BoardStore(path), new BoardStore(path)]
	const stores = boards.map((board) => board.forTenant(LOCAL_TENANT))
	try {
		const states = await Promise.all(stores.map((store) => store.getState()))
		assert.equal(states[0].activeCanvasId, states[1].activeCanvasId)
		const results = await Promise.allSettled(
			Array.from({ length: MAX_CANVAS_IMAGES + 1 }, (_, index) =>
				stores[index % 2].placeGeneratedImage({
					canvasId: states[0].activeCanvasId,
					shapeId: `generated-${index}`,
					x: index * 300,
					y: 0,
					w: 100,
					h: 100,
					bytes: png,
				}),
			),
		)
		assert.equal(
			results.filter((result) => result.status === 'fulfilled').length,
			MAX_CANVAS_IMAGES,
		)
		const rejected = results.filter((result) => result.status === 'rejected')
		assert.equal(rejected.length, 1)
		assert.ok(rejected[0].reason instanceof OperationError)
		assert.equal(rejected[0].reason.code, 'IMAGE_CAP_REACHED')
		const board = await stores[0].getBoard()
		const images = board.shapes.filter((shape) => shape.type === 'image')
		assert.equal(images.length, MAX_CANVAS_IMAGES)
		assert.equal(board.revision, MAX_CANVAS_IMAGES)
		const assets = await boards[0].sql.all<{ id: string }>('SELECT id FROM image_assets')
		assert.deepEqual(
			new Set(assets.map((asset) => asset.id)),
			new Set(
				images.map((image) => {
					assert.ok(image.type === 'image')
					return image.imageId
				}),
			),
		)
		assert.deepEqual(await stores[1].getBoard(), board)
	} finally {
		await Promise.all(boards.map((board) => board.close()))
		rmSync(directory, { recursive: true, force: true })
	}
})
