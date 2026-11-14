import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BoardStore, LOCAL_TENANT, OperationError } from './store.ts'
import { tenantScopeFor } from './tenant.ts'

const IDENTITY = '11111111-1111-1111-1111-111111111111:33333333-3333-3333-3333-333333333333'

test('an anonymous request resolves to the local tenant', () => {
	assert.deepEqual(tenantScopeFor(undefined), LOCAL_TENANT)
	assert.equal(tenantScopeFor(undefined).tenantId, 'local')
})

test('each identity resolves to its own stable opaque tenant', () => {
	const first = tenantScopeFor({ identity: IDENTITY })
	const again = tenantScopeFor({ identity: IDENTITY })
	const other = tenantScopeFor({
		identity: `${IDENTITY.split(':')[0]}:44444444-4444-4444-4444-444444444444`,
	})
	assert.equal(first.tenantId, again.tenantId)
	assert.notEqual(first.tenantId, other.tenantId)
	assert.match(first.tenantId, /^ten-[0-9a-f]{32}$/)
	assert.ok(!first.tenantId.includes(IDENTITY.split(':')[1]))
})

test('tenants keep separate canvas lists, canvases and images', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-tenant-'))
	const boards = new BoardStore(join(directory, 'board.sqlite'))
	const alpha = boards.forTenant({ tenantId: 'ten-alpha' })
	const beta = boards.forTenant({ tenantId: 'ten-beta' })
	try {
		const alphaState = await alpha.getState()
		assert.equal(alphaState.canvases.length, 1)
		assert.equal((await beta.getState()).canvases.length, 1)
		assert.notEqual(alphaState.activeCanvasId, (await beta.getState()).activeCanvasId)

		await alpha.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'note', type: 'note', x: 0, y: 0, w: 100, h: 80, color: '#fff8d4' },
				},
			],
		})
		assert.equal((await alpha.getBoard()).shapes.length, 1)
		assert.equal((await beta.getBoard()).shapes.length, 0)
		assert.deepEqual(
			(await beta.getState()).canvases.map((canvas) => canvas.id),
			[(await beta.getState()).activeCanvasId],
		)

		const alphaCanvas = await alpha.createCanvas('Alpha only')
		assert.ok(
			(await beta.getState()).canvases.every((canvas) => canvas.id !== alphaCanvas.canvas.id),
		)
		await assert.rejects(
			() => beta.getCanvas(alphaCanvas.canvas.id),
			(error: unknown) => error instanceof OperationError && error.status === 404,
		)

		await alpha.activateCanvas(alphaCanvas.canvas.id)
		assert.equal((await alpha.getState()).activeCanvasId, alphaCanvas.canvas.id)
		assert.notEqual((await beta.getState()).activeCanvasId, alphaCanvas.canvas.id)
		assert.notEqual((await alpha.getState()).stateVersion, (await beta.getState()).stateVersion)

		const imageId = await alpha.saveImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png')
		assert.ok(await alpha.getImage(imageId))
		assert.equal(await beta.getImage(imageId), undefined)
	} finally {
		await boards.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('a tenant cannot delete or read another tenant canvas by id', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-tenant-'))
	const boards = new BoardStore(join(directory, 'board.sqlite'))
	const alpha = boards.forTenant({ tenantId: 'ten-alpha' })
	const beta = boards.forTenant({ tenantId: 'ten-beta' })
	try {
		const created = await alpha.createCanvas('Private')
		await assert.rejects(
			() => beta.deleteCanvas(created.canvas.id),
			(error: unknown) => error instanceof OperationError && error.status === 404,
		)
		await assert.rejects(
			() =>
				beta.applyRequest({
					canvasId: created.canvas.id,
					operations: [{ type: 'delete', id: 'missing' }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 404,
		)
		assert.equal((await alpha.getCanvas(created.canvas.id)).canvas.name, 'Private')
	} finally {
		await boards.close()
		rmSync(directory, { recursive: true, force: true })
	}
})
