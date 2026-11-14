import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { boardDigest, formatBoardContext } from './aiBoard.ts'
import { createCanvasTools } from './aiTools.ts'
import { BoardStore, LOCAL_TENANT, type TenantStore } from './store.ts'

async function withStore(run: (store: TenantStore) => Promise<void>) {
	const directory = mkdtempSync(join(tmpdir(), 'mico-backend-regressions-'))
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
		toolCallId: 'regression',
		messages: [],
	})
const toolsFor = async (store: TenantStore, selection: string[] = []) =>
	createCanvasTools({
		store,
		broadcast: () => {},
		selection,
		canvasId: await store.getActiveCanvasId(),
	})
const note = (id: string, values = {}) => ({
	id,
	type: 'note' as const,
	x: 40,
	y: 20,
	w: 200,
	h: 140,
	color: '#fff8d4',
	text: 'Existing note',
	...values,
})
const frame = (values = {}) => ({
	id: 'f',
	type: 'frame' as const,
	x: 0,
	y: 0,
	w: 800,
	h: 168,
	color: '#00a2e1',
	title: 'Frame',
	...values,
})

test('additive AI writes do not acknowledge unread concurrent edits', async () => {
	await withStore(async (store) => {
		const tools = await toolsFor(store)
		const input = {
			id: 'a',
			title: 'Actions',
			x: 0,
			y: 0,
			items: [{ id: 'one', text: 'Original deadline' }],
		}
		await run(tools.upsert_action_card, input)
		await store.apply({
			expectedRevision: 1,
			operations: [
				{
					type: 'update',
					id: 'a',
					patch: { items: [{ id: 'one', text: 'Corrected by user', done: true }] },
				},
			],
		})
		const created = (await run(tools.add_notes, {
			notes: [{ id: 'unrelated', x: 1000, y: 0, text: 'New unrelated note' }],
		})) as { ok: boolean }
		assert.equal(created.ok, true)
		const stale = (await run(tools.upsert_action_card, input)) as { error?: string }
		assert.equal(stale.error, 'REVISION_CONFLICT')
		const action = (await store.getBoard()).shapes.find((shape) => shape.id === 'a')
		assert.ok(action && action.type === 'actions')
		assert.deepEqual(action.items, [{ id: 'one', text: 'Corrected by user', done: true }])
		await run(tools.get_board, { ids: ['a'] })
		const refreshed = (await run(tools.upsert_action_card, input)) as { ok: boolean }
		assert.equal(refreshed.ok, true)
	})
})

test('label growth keeps connectors between members of the same frame', async () => {
	await withStore(async (store) => {
		await store.apply({
			operations: [
				{ type: 'create', shape: frame() },
				{ type: 'create', shape: note('n', { frameId: 'f' }) },
				{ type: 'create', shape: note('peer', { x: 400, h: 100, frameId: 'f' }) },
				{
					type: 'create',
					shape: {
						id: 'edge',
						type: 'connector',
						from: 'n',
						to: 'peer',
						fromAnchor: 1,
						toAnchor: 2,
						color: '#00a2e1',
					},
				},
			],
		})
		const result = await store.apply({
			operations: [{ type: 'update', id: 'n', patch: { label: 'Risk' } }],
		})
		const region = result.shapes.find((shape) => shape.id === 'f')
		assert.ok(region && region.type === 'frame')
		assert.equal(region.h, 219)
		assert.ok(result.shapes.some((shape) => shape.id === 'edge'))
	})
})

test('AI frame growth allows connectors between frame members', async () => {
	await withStore(async (store) => {
		await store.apply({
			operations: [
				{ type: 'create', shape: frame() },
				{ type: 'create', shape: note('n', { frameId: 'f' }) },
				{ type: 'create', shape: note('peer', { x: 400, h: 100, frameId: 'f' }) },
				{
					type: 'create',
					shape: {
						id: 'edge',
						type: 'connector',
						from: 'n',
						to: 'peer',
						fromAnchor: 1,
						toAnchor: 2,
						color: '#00a2e1',
					},
				},
			],
		})
		const reply = (await run((await toolsFor(store)).update_shapes, {
			updates: [{ id: 'n', patch: { y: 20, label: 'Risk' } }],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const region = (await store.getBoard()).shapes.find((shape) => shape.id === 'f')
		assert.ok(region && region.type === 'frame')
		assert.equal(region.y + region.h, 219)
	})
})

test('selected action cards remain bounded until explicitly inspected', async () => {
	await withStore(async (store) => {
		const tools = await toolsFor(store)
		await run(tools.upsert_action_card, {
			id: 'a',
			title: 'Actions',
			x: 0,
			y: 0,
			items: Array.from({ length: 200 }, (_, index) => ({
				id: `item-${index}`,
				text: '界'.repeat(1000),
			})),
		})
		const board = await store.getBoard()
		assert.equal(boardDigest(board, ['a']).shapes[0].items?.length, 3)
		assert.ok(formatBoardContext(board, ['a']).length < 5000)
		const selected = await toolsFor(store, ['a'])
		const normal = (await run(selected.get_board, {})) as { shapes: { items: unknown[] }[] }
		const full = (await run(selected.get_board, { ids: ['a'] })) as {
			shapes: { items: unknown[] }[]
		}
		assert.equal(normal.shapes[0].items.length, 3)
		assert.equal(full.shapes[0].items.length, 200)
	})
})

test('AI frame growth rejects unrelated connectors in the newly occupied area', async () => {
	await withStore(async (store) => {
		const before = await store.apply({
			operations: [
				{ type: 'create', shape: frame({ h: 220 }) },
				{ type: 'create', shape: note('n', { y: 40, frameId: 'f' }) },
				{ type: 'create', shape: note('left', { x: -200, y: 210, w: 100, h: 40 }) },
				{ type: 'create', shape: note('right', { x: 1000, y: 210, w: 100, h: 40 }) },
				{
					type: 'create',
					shape: {
						id: 'external-edge',
						type: 'connector',
						from: 'left',
						to: 'right',
						fromAnchor: 3,
						toAnchor: 2,
						color: '#00a2e1',
					},
				},
			],
		})
		const reply = (await run((await toolsFor(store)).update_shapes, {
			updates: [{ id: 'n', patch: { y: 40, label: 'Risk' } }],
		})) as { ok: boolean; error?: string }
		assert.equal(reply.error, 'FRAME_COLLISION')
		assert.deepEqual(await store.getBoard(), before)
	})
})

test('AI frame preflight uses connector rewiring from the same atomic batch', async () => {
	for (const initiallyLow of [true, false]) {
		await withStore(async (store) => {
			const before = await store.apply({
				operations: [
					{ type: 'create', shape: frame({ h: 220 }) },
					{ type: 'create', shape: note('n', { y: 40, frameId: 'f' }) },
					{ type: 'create', shape: note('left-low', { x: -200, y: 210, w: 100, h: 40 }) },
					{ type: 'create', shape: note('right-low', { x: 1000, y: 210, w: 100, h: 40 }) },
					{ type: 'create', shape: note('left-high', { x: -200, y: 280, w: 100, h: 40 }) },
					{ type: 'create', shape: note('right-high', { x: 1000, y: 280, w: 100, h: 40 }) },
					{
						type: 'create',
						shape: {
							id: 'edge',
							type: 'connector',
							color: '#00a2e1',
							fromAnchor: 3,
							toAnchor: 2,
							from: initiallyLow ? 'left-low' : 'left-high',
							to: initiallyLow ? 'right-low' : 'right-high',
						},
					},
				],
			})
			const reply = (await run((await toolsFor(store)).update_shapes, {
				updates: [
					{ id: 'n', patch: { y: 40, label: 'Risk' } },
					{
						id: 'edge',
						patch: {
							from: initiallyLow ? 'left-high' : 'left-low',
							to: initiallyLow ? 'right-high' : 'right-low',
						},
					},
				],
			})) as { ok: boolean; error?: string }
			if (initiallyLow) {
				assert.equal(reply.ok, true)
				const edge = (await store.getBoard()).shapes.find((shape) => shape.id === 'edge')
				assert.ok(edge && edge.type === 'connector')
				assert.equal(edge.from, 'left-high')
			} else {
				assert.equal(reply.error, 'FRAME_COLLISION')
				assert.deepEqual(await store.getBoard(), before)
			}
		})
	}
})

test('AI preflight uses compensated note height when removing a label', async () => {
	await withStore(async (store) => {
		await store.apply({
			operations: [
				{ type: 'create', shape: frame({ w: 400, h: 240 }) },
				{ type: 'create', shape: note('n', { y: 40, h: 160, label: 'Risk', frameId: 'f' }) },
				{ type: 'create', shape: note('external', { x: 300, y: 250, w: 100, h: 100 }) },
			],
		})
		const reply = (await run((await toolsFor(store)).update_shapes, {
			updates: [{ id: 'n', patch: { y: 60, label: '' } }],
		})) as { ok: boolean }
		assert.equal(reply.ok, true)
		const board = await store.getBoard()
		const region = board.shapes.find((shape) => shape.id === 'f')
		const member = board.shapes.find((shape) => shape.id === 'n')
		assert.ok(region && region.type === 'frame')
		assert.ok(member && member.type === 'note')
		assert.equal(region.h, 241)
		assert.equal(member.h, 141)
	})
})
