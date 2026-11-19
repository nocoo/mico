import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { CanvasShape, Operation } from '../shared/types.ts'
import { BoardStore, DEMO_TENANT, OperationError } from './store.ts'

const alice = 'a'.repeat(64)
const bob = 'b'.repeat(64)
const presenter = 'c'.repeat(64)
const shape = (id: string): CanvasShape => ({
	id,
	type: 'rectangle',
	x: 10,
	y: 10,
	w: 80,
	h: 80,
	color: '#123456',
})
const forbidden = (error: unknown) =>
	error instanceof OperationError && error.code === 'OBJECT_EDIT_FORBIDDEN'

test('demo ownership and per-canvas grants survive reopening and preserve original ownership', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ownership-'))
	const path = join(directory, 'board.sqlite')
	let boards = new BoardStore(path)
	try {
		const raw = boards.forTenant(DEMO_TENANT)
		const owner = raw.forDemoParticipant(() => ({ participantId: alice, presenter: false }))
		const guest = raw.forDemoParticipant(() => ({ participantId: bob, presenter: false }))
		const host = raw.forDemoParticipant(() => ({ participantId: presenter, presenter: true }))
		const first = (await raw.getState()).activeCanvasId
		const second = (await raw.createCanvas('Second')).canvas.id
		await raw.apply({ operations: [{ type: 'create', shape: shape('legacy') }] })
		for (const canvasId of [first, second])
			await owner.apply({ canvasId, operations: [{ type: 'create', shape: shape('owned') }] })
		await owner.apply({ operations: [{ type: 'update', id: 'owned', patch: { x: 20 } }] })
		await assert.rejects(guest.apply({ operations: [{ type: 'delete', id: 'owned' }] }), forbidden)
		await assert.rejects(owner.apply({ operations: [{ type: 'delete', id: 'legacy' }] }), forbidden)
		await assert.rejects(
			guest.setCanvasEditor(first, bob, true),
			(error: unknown) => error instanceof OperationError && error.status === 403,
		)
		await host.setCanvasEditor(first, bob, true)
		await guest.apply({ operations: [{ type: 'update', id: 'owned', patch: { x: 30 } }] })
		await guest.apply({ operations: [{ type: 'update', id: 'legacy', patch: { y: 30 } }] })
		await assert.rejects(
			guest.apply({ canvasId: second, operations: [{ type: 'delete', id: 'owned' }] }),
			forbidden,
		)
		await boards.close()
		boards = new BoardStore(path)
		const reopened = boards.forTenant(DEMO_TENANT)
		const returningOwner = reopened.forDemoParticipant(() => ({
			participantId: alice,
			presenter: false,
		}))
		const returningGuest = reopened.forDemoParticipant(() => ({
			participantId: bob,
			presenter: false,
		}))
		const returningHost = reopened.forDemoParticipant(() => ({
			participantId: presenter,
			presenter: true,
		}))
		assert.deepEqual((await reopened.getState()).canvasEditorIds, [bob])
		await returningGuest.apply({ operations: [{ type: 'update', id: 'owned', patch: { x: 40 } }] })
		await returningHost.setCanvasEditor(first, bob, false)
		await assert.rejects(
			returningGuest.apply({ operations: [{ type: 'update', id: 'owned', patch: { x: 50 } }] }),
			forbidden,
		)
		const before = await returningOwner.getBoard()
		const original = before.shapes.find((item) => item.id === 'owned')
		assert.ok(original)
		const deleted = await returningOwner.apply({ operations: [{ type: 'delete', id: 'owned' }] })
		await assert.rejects(
			returningGuest.apply({ operations: [{ type: 'create', shape: shape('owned') }] }),
			forbidden,
		)
		await assert.rejects(
			returningGuest.apply({
				expectedRevision: deleted.revision,
				operations: [{ type: 'restore', shape: original, index: 1 }],
			}),
			forbidden,
		)
		await returningOwner.apply({
			expectedRevision: deleted.revision,
			operations: [{ type: 'restore', shape: original, index: 1 }],
		})
		await returningHost.apply({ operations: [{ type: 'delete', id: 'legacy' }] })
		await assert.rejects(
			returningGuest.apply({ operations: [{ type: 'create', shape: shape('legacy') }] }),
			forbidden,
		)
	} finally {
		await boards.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('demo mixed batches, restore, actions and cascading changes enforce every affected owner atomically', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-ownership-cascade-'))
	const boards = new BoardStore(join(directory, 'board.sqlite'))
	try {
		const raw = boards.forTenant(DEMO_TENANT)
		const owner = raw.forDemoParticipant(() => ({ participantId: alice, presenter: false }))
		const guest = raw.forDemoParticipant(() => ({ participantId: bob, presenter: false }))
		const host = raw.forDemoParticipant(() => ({ participantId: presenter, presenter: true }))
		await owner.apply({
			operations: [
				{ type: 'create', shape: shape('source') },
				{ type: 'create', shape: { ...shape('frame'), type: 'frame', title: 'Frame' } },
				{
					type: 'create',
					shape: {
						...shape('actions'),
						type: 'actions',
						title: 'Tasks',
						items: [{ id: 'task', text: 'Task', done: false }],
					},
				},
			],
		})
		await guest.apply({
			operations: [
				{ type: 'create', shape: { ...shape('target'), frameId: 'frame' } },
				{
					type: 'create',
					shape: { id: 'link', type: 'connector', from: 'source', to: 'target', color: '#123456' },
				},
			],
		})
		const before = await raw.getBoard()
		for (const id of ['source', 'frame']) {
			await assert.rejects(owner.apply({ operations: [{ type: 'delete', id }] }), forbidden)
			assert.deepEqual(await raw.getBoard(), before)
		}
		const batches: Operation[][] = [
			[
				{ type: 'create', shape: shape('rollback') },
				{ type: 'update', id: 'source', patch: { x: 99 } },
			],
			[{ type: 'restore', shape: { ...shape('source'), color: '#abcdef' }, index: 0 }],
			[{ type: 'set_action_done', id: 'actions', itemId: 'task', done: true }],
		]
		for (const operations of batches) {
			await assert.rejects(
				guest.apply({ expectedRevision: before.revision, operations }),
				forbidden,
			)
			assert.deepEqual(await raw.getBoard(), before)
		}
		await owner.apply({ operations: [{ type: 'create', shape: shape('rollback') }] })
		await assert.rejects(
			guest.apply({
				operations: [{ type: 'create', shape: { ...shape('spoof'), participantId: alice } }],
			}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		await host.setCanvasEditor((await raw.getState()).activeCanvasId, alice, true)
		await owner.apply({
			operations: [
				{ type: 'delete', id: 'source' },
				{ type: 'delete', id: 'frame' },
			],
		})
		const after = await raw.getBoard()
		assert.equal(
			after.shapes.some((item) => item.id === 'link'),
			false,
		)
		assert.equal(after.shapes.find((item) => item.id === 'target')?.type, 'rectangle')
	} finally {
		await boards.close()
		rmSync(directory, { recursive: true, force: true })
	}
})
