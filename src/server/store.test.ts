import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { BoardStore, OperationError } from './store.ts'

test('operations are atomic and delete cascades connectors', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'nested', 'board.sqlite')
	const store = new BoardStore(dbPath)

	try {
		const created = store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'a', type: 'rectangle', x: 1, y: 2, w: 30, h: 40, color: '#123456' },
				},
				{
					type: 'create',
					shape: { id: 'b', type: 'ellipse', x: 100, y: 0, w: 10, h: 10, color: '#000000' },
				},
				{
					type: 'create',
					shape: { id: 'c', type: 'connector', from: 'a', to: 'b', color: '#654321' },
				},
			],
		})
		assert.equal(created.revision, 1)
		assert.equal(created.shapes.length, 3)

		assert.throws(
			() =>
				store.apply({
					operations: [
						{
							type: 'create',
							shape: { id: 'd', type: 'ellipse', x: 0, y: 0, w: 10, h: 10, color: '#000000' },
						},
						{ type: 'update', id: 'missing', patch: { x: 5 } },
					],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 404,
		)
		assert.deepEqual(
			store.getBoard().shapes.map((shape) => shape.id),
			['a', 'b', 'c'],
		)

		assert.throws(
			() => store.apply({ operations: [], expectedRevision: 0 }),
			(error: unknown) => error instanceof OperationError && error.status === 409,
		)

		assert.throws(() =>
			store.apply({
				operations: [
					{
						type: 'create',
						shape: { id: 'self', type: 'connector', from: 'a', to: 'a', color: '#123456' },
					},
				],
			}),
		)
		const deleted = store.apply({
			operations: [
				{ type: 'delete', id: 'a' },
				{ type: 'delete', id: 'c' },
				{ type: 'delete', id: 'b' },
			],
		})
		assert.equal(deleted.revision, 2)
		assert.deepEqual(deleted.shapes, [])
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('lines can point in any direction while other shapes require non-negative sizes and valid colors', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		const line = { id: 'line', type: 'line', x: 10, y: 10, w: -20, h: -30, color: '#123456' }
		store.apply({ operations: [{ type: 'create', shape: line }] })
		store.apply({ operations: [{ type: 'update', id: 'line', patch: { w: -50 } }] })
		assert.throws(() =>
			store.apply({
				operations: [{ type: 'create', shape: { ...line, id: 'rect', type: 'rectangle' } }],
			}),
		)
		assert.throws(() =>
			store.apply({ operations: [{ type: 'update', id: 'line', patch: { color: 'invalid' } }] }),
		)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('multiple stores on one database do not overwrite each other', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	const first = new BoardStore(dbPath)
	const second = new BoardStore(dbPath)
	try {
		const shape = { id: 'a', type: 'rectangle', x: 0, y: 0, w: 100, h: 40, color: '#123456' }
		first.apply({ operations: [{ type: 'create', shape }] })
		assert.throws(
			() =>
				second.apply({
					expectedRevision: 0,
					operations: [{ type: 'create', shape: { ...shape, id: 'b' } }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 409,
		)
		second.apply({ operations: [{ type: 'create', shape: { ...shape, id: 'b' } }] })
		assert.deepEqual(
			first.getBoard().shapes.map((item) => item.id),
			['a', 'b'],
		)
	} finally {
		first.close()
		second.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('board persists in sqlite', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	let store = new BoardStore(dbPath)

	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'text',
						type: 'text',
						x: 3,
						y: 4,
						w: 100,
						h: 20,
						color: '#ffffff',
						text: 'hello',
					},
				},
			],
		})
		store.close()
		store = new BoardStore(dbPath)
		assert.deepEqual(store.getBoard(), {
			revision: 1,
			shapes: [
				{ id: 'text', type: 'text', x: 3, y: 4, w: 100, h: 20, color: '#ffffff', text: 'hello' },
			],
		})
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('note labels persist and only apply to note shapes', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	let store = new BoardStore(dbPath)
	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'note',
						type: 'note',
						x: 10,
						y: 20,
						w: 200,
						h: 130,
						color: '#fff8d4',
						text: 'Follow up',
						label: 'Action',
					},
				},
			],
		})
		store.apply({
			operations: [{ type: 'update', id: 'note', patch: { label: 'Resolved' } }],
		})
		store.close()
		store = new BoardStore(dbPath)
		const persisted = store.getBoard().shapes[0]
		assert.equal(persisted?.type === 'connector' ? undefined : persisted?.label, 'Resolved')
		assert.throws(() =>
			store.apply({
				operations: [
					{
						type: 'create',
						shape: {
							id: 'box',
							type: 'rectangle',
							x: 0,
							y: 0,
							w: 100,
							h: 80,
							color: '#00a2e1',
							label: 'Invalid',
						},
					},
				],
			}),
		)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('action cards persist stable items and set_action_done is guarded and item-scoped', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	let store = new BoardStore(dbPath)
	try {
		const card = {
			id: 'actions',
			type: 'actions' as const,
			x: 20,
			y: 30,
			w: 360,
			h: 180,
			color: '#00a2e1',
			title: 'Next steps',
			items: [
				{ id: 'follow-up', text: 'Follow up', done: false },
				{ id: 'review', text: 'Review results', done: true },
			],
		}
		const created = store.apply({ operations: [{ type: 'create', shape: card }] })
		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'set_action_done', id: 'actions', itemId: 'follow-up', done: true }],
				}),
			/expectedRevision/,
		)
		const changed = store.apply({
			expectedRevision: created.revision,
			operations: [{ type: 'set_action_done', id: 'actions', itemId: 'follow-up', done: true }],
		})
		assert.deepEqual(changed.shapes[0].type === 'actions' ? changed.shapes[0].items : [], [
			{ id: 'follow-up', text: 'Follow up', done: true },
			{ id: 'review', text: 'Review results', done: true },
		])
		assert.throws(
			() =>
				store.apply({
					expectedRevision: created.revision,
					operations: [{ type: 'set_action_done', id: 'actions', itemId: 'review', done: false }],
				}),
			(error: unknown) => error instanceof OperationError && error.code === 'REVISION_CONFLICT',
		)
		assert.throws(() =>
			store.apply({
				expectedRevision: changed.revision,
				operations: [{ type: 'set_action_done', id: 'actions', itemId: 'missing', done: true }],
			}),
		)
		store.close()
		store = new BoardStore(dbPath)
		assert.deepEqual(store.getBoard(), changed)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('action cards reject malformed and duplicate item ids atomically', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		const shape = {
			id: 'actions',
			type: 'actions',
			x: 0,
			y: 0,
			w: 300,
			h: 160,
			color: '#00a2e1',
			title: 'Actions',
			items: [{ id: 'one', text: 'One', done: false }],
		}
		store.apply({ operations: [{ type: 'create', shape }] })
		const before = store.getBoard()
		for (const patch of [
			{ title: '' },
			{
				items: [
					{ id: 'duplicate', text: 'One', done: false },
					{ id: 'duplicate', text: 'Two', done: false },
				],
			},
			{ items: [{ id: '', text: 'One', done: false }] },
			{ items: [{ id: 'one', text: '', done: false }] },
			{ items: [{ id: 'one', text: 'One' }] },
			{ items: [{ id: 'one', text: 'One', done: false, owner: 'AI' }] },
		]) {
			assert.throws(() => store.apply({ operations: [{ type: 'update', id: 'actions', patch }] }))
			assert.deepEqual(store.getBoard(), before)
		}
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('connectors persist optional anchor pins within the referenced anchor range', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	let store = new BoardStore(dbPath)

	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'a', type: 'rectangle', x: 0, y: 0, w: 100, h: 80, color: '#123456' },
				},
				{
					type: 'create',
					shape: { id: 'b', type: 'line', x: 200, y: 0, w: -50, h: -20, color: '#123456' },
				},
				{
					type: 'create',
					shape: {
						id: 'c',
						type: 'connector',
						from: 'a',
						to: 'b',
						color: '#654321',
						fromAnchor: 3,
						toAnchor: 4,
					},
				},
			],
		})
		const connector = store.getBoard().shapes.find((shape) => shape.id === 'c')
		assert.deepEqual(connector, {
			id: 'c',
			type: 'connector',
			from: 'a',
			to: 'b',
			color: '#654321',
			fromAnchor: 3,
			toAnchor: 4,
		})

		store.close()
		store = new BoardStore(dbPath)
		const persisted = store.getBoard().shapes.find((shape) => shape.id === 'c')
		assert.equal(persisted?.type, 'connector')
		assert.equal(persisted?.type === 'connector' ? persisted.fromAnchor : undefined, 3)
		assert.equal(persisted?.type === 'connector' ? persisted.toAnchor : undefined, 4)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('anchor pins outside the referenced anchor range are rejected', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))

	const connector = (extra: Record<string, unknown>) => ({
		id: 'c',
		type: 'connector',
		from: 'a',
		to: 'b',
		color: '#654321',
		...extra,
	})

	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'a', type: 'rectangle', x: 0, y: 0, w: 100, h: 80, color: '#123456' },
				},
				{
					type: 'create',
					shape: { id: 'b', type: 'line', x: 200, y: 0, w: -50, h: -20, color: '#123456' },
				},
			],
		})

		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'create', shape: connector({ fromAnchor: 12 }) }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'create', shape: connector({ toAnchor: 5 }) }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'create', shape: connector({ fromAnchor: -1 }) }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'create', shape: connector({ fromAnchor: 1.5 }) }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'create', shape: connector({ fromAnchor: null }) }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)

		store.apply({
			operations: [{ type: 'create', shape: connector({ fromAnchor: 11, toAnchor: 4 }) }],
		})
		assert.equal(store.getBoard().shapes.length, 3)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('updating and rebinding a connector revalidates its anchor pins', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))

	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'a', type: 'rectangle', x: 0, y: 0, w: 100, h: 80, color: '#123456' },
				},
				{
					type: 'create',
					shape: { id: 'b', type: 'rectangle', x: 300, y: 0, w: 100, h: 80, color: '#123456' },
				},
				{
					type: 'create',
					shape: { id: 'l', type: 'line', x: 0, y: 200, w: 100, h: 40, color: '#123456' },
				},
				{
					type: 'create',
					shape: {
						id: 'c',
						type: 'connector',
						from: 'a',
						to: 'b',
						color: '#654321',
						fromAnchor: 11,
					},
				},
			],
		})

		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'update', id: 'c', patch: { fromAnchor: 12 } }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'update', id: 'c', patch: { fromAnchor: 2.5 } }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'update', id: 'a', patch: { fromAnchor: 1 } }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)

		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'update', id: 'c', patch: { from: 'l' } }],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		store.apply({
			operations: [{ type: 'update', id: 'c', patch: { from: 'l', fromAnchor: 4 } }],
		})
		const rebound = store.getBoard().shapes.find((shape) => shape.id === 'c')
		assert.equal(rebound?.type === 'connector' ? rebound.from : undefined, 'l')
		assert.equal(rebound?.type === 'connector' ? rebound.fromAnchor : undefined, 4)

		store.apply({
			operations: [{ type: 'update', id: 'c', patch: { toAnchor: 7 } }],
		})
		const updated = store.getBoard().shapes.find((shape) => shape.id === 'c')
		assert.equal(updated?.type === 'connector' ? updated.toAnchor : undefined, 7)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('rejected anchor pins leave the board untouched', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))

	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'a', type: 'rectangle', x: 0, y: 0, w: 100, h: 80, color: '#123456' },
				},
				{
					type: 'create',
					shape: { id: 'b', type: 'rectangle', x: 300, y: 0, w: 100, h: 80, color: '#123456' },
				},
			],
		})
		const before = store.getBoard()

		assert.throws(
			() =>
				store.apply({
					operations: [
						{
							type: 'create',
							shape: {
								id: 'd',
								type: 'rectangle',
								x: 0,
								y: 300,
								w: 50,
								h: 50,
								color: '#123456',
							},
						},
						{
							type: 'create',
							shape: {
								id: 'c',
								type: 'connector',
								from: 'a',
								to: 'b',
								color: '#654321',
								fromAnchor: 12,
							},
						},
					],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.deepEqual(store.getBoard(), before)
		assert.equal(store.getBoard().revision, before.revision)
		assert.deepEqual(
			store.getBoard().shapes.map((shape) => shape.id),
			['a', 'b'],
		)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('boards with out of range anchor pins fail to load', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	const store = new BoardStore(dbPath)

	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'a', type: 'rectangle', x: 0, y: 0, w: 100, h: 80, color: '#123456' },
				},
				{
					type: 'create',
					shape: { id: 'b', type: 'rectangle', x: 300, y: 0, w: 100, h: 80, color: '#123456' },
				},
			],
		})
		store.db.prepare("UPDATE canvases SET shapes = ? WHERE id = 'main'").run(
			JSON.stringify([
				{ id: 'a', type: 'rectangle', x: 0, y: 0, w: 100, h: 80, color: '#123456' },
				{ id: 'b', type: 'rectangle', x: 300, y: 0, w: 100, h: 80, color: '#123456' },
				{
					id: 'c',
					type: 'connector',
					from: 'a',
					to: 'b',
					color: '#654321',
					fromAnchor: 12,
				},
			]),
		)
		store.close()
		assert.throws(() => new BoardStore(dbPath).getBoard())
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('path shapes validate brush, stroke width and in-bounds points', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	const path = {
		id: 'stroke',
		type: 'path' as const,
		x: 10,
		y: 20,
		w: 40,
		h: 30,
		color: '#5b5fc7',
		brush: 'brush' as const,
		strokeWidth: 6,
		points: [
			{ x: 0, y: 0 },
			{ x: 20, y: 15 },
			{ x: 40, y: 30 },
		],
	}
	try {
		store.apply({ operations: [{ type: 'create', shape: path }] })
		assert.deepEqual(store.getBoard().shapes[0], path)

		for (const patch of [
			{ brush: 'spray' },
			{ strokeWidth: 0 },
			{ strokeWidth: 65 },
			{ points: [{ x: 0, y: 0 }] },
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 41, y: 0 },
				],
			},
			{
				points: [
					{ x: 0, y: 0 },
					{ x: Number.NaN, y: 0 },
				],
			},
		]) {
			assert.throws(
				() => store.apply({ operations: [{ type: 'update', id: 'stroke', patch }] }),
				(error: unknown) => error instanceof OperationError && error.status === 400,
				JSON.stringify(patch),
			)
		}

		const widened = store.apply({
			operations: [
				{
					type: 'update',
					id: 'stroke',
					patch: {
						w: 80,
						points: [
							{ x: 0, y: 0 },
							{ x: 60, y: 30 },
						],
					},
				},
			],
		})
		assert.equal(widened.shapes[0].type, 'path')
		assert.deepEqual((widened.shapes[0] as { points: unknown }).points, [
			{ x: 0, y: 0 },
			{ x: 60, y: 30 },
		])

		assert.throws(
			() =>
				store.apply({
					operations: [
						{ type: 'create', shape: { ...path, id: 'other' } },
						{ type: 'create', shape: { ...path, id: 'bad', brush: 'spray' } },
					],
				}),
			(error: unknown) => error instanceof OperationError,
		)
		assert.equal(store.getBoard().shapes.length, 1)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('frames hold named members, reject nesting and ungroup on delete', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		const frame = {
			id: 'frame-1',
			type: 'frame' as const,
			x: 100,
			y: 100,
			w: 400,
			h: 300,
			color: '#5b5fc7',
			title: 'Discovery',
		}
		const note = {
			id: 'note-1',
			type: 'note' as const,
			x: 140,
			y: 160,
			w: 160,
			h: 160,
			color: '#fde68a',
			text: 'Idea',
			frameId: 'frame-1',
		}
		const heading = {
			id: 'text-1',
			type: 'text' as const,
			x: 140,
			y: 340,
			w: 240,
			h: 48,
			color: '#242424',
			text: 'Heading',
			font: 'hand' as const,
			fontSize: 32,
			fontWeight: 600,
			frameId: 'frame-1',
		}
		const board = store.apply({
			operations: [
				{ type: 'create', shape: frame },
				{ type: 'create', shape: note },
				{ type: 'create', shape: heading },
			],
		})
		assert.equal(board.shapes.length, 3)
		assert.deepEqual(
			board.shapes.filter((shape) => shape.type !== 'connector').map((shape) => shape.frameId),
			[undefined, 'frame-1', 'frame-1'],
		)

		for (const operations of [
			[{ type: 'create', shape: { ...frame, id: 'frame-2', frameId: 'frame-1' } }],
			[{ type: 'update', id: 'note-1', patch: { frameId: 'missing' } }],
			[{ type: 'update', id: 'frame-1', patch: { frameId: 'frame-1' } }],
			[{ type: 'update', id: 'note-1', patch: { font: 'hand' } }],
			[{ type: 'update', id: 'text-1', patch: { fontSize: 4 } }],
			[{ type: 'update', id: 'text-1', patch: { fontWeight: 950 } }],
			[{ type: 'update', id: 'frame-1', patch: { title: '' } }],
		] as const) {
			assert.throws(
				() => store.apply({ operations: [...operations] }),
				(error: unknown) => error instanceof OperationError && error.status === 400,
				JSON.stringify(operations),
			)
		}

		const ungrouped = store.apply({ operations: [{ type: 'delete', id: 'frame-1' }] })
		assert.deepEqual(
			ungrouped.shapes.map((shape) => [
				shape.id,
				shape.type === 'connector' ? undefined : shape.frameId,
			]),
			[
				['note-1', undefined],
				['text-1', undefined],
			],
		)
		assert.equal(ungrouped.shapes.length, 2)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('html cards embed generated markup and expose only title and html', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		const frame = {
			id: 'html-frame',
			type: 'frame' as const,
			x: 0,
			y: 0,
			w: 640,
			h: 480,
			color: '#5b5fc7',
			title: 'Dashboard',
		}
		const card = {
			id: 'html-card',
			type: 'html' as const,
			x: 40,
			y: 60,
			w: 520,
			h: 360,
			color: '#5b5fc7',
			title: 'Revenue',
			html: '<p>Quarterly revenue</p>',
			frameId: 'html-frame',
		}
		store.apply({
			operations: [
				{ type: 'create', shape: frame },
				{ type: 'create', shape: card },
			],
		})
		const updated = store.apply({
			operations: [
				{
					type: 'update',
					id: 'html-card',
					patch: { title: 'Revenue 2026', html: '<strong>Updated</strong>' },
				},
			],
		})
		assert.deepEqual(
			updated.shapes.find((shape) => shape.id === 'html-card'),
			{ ...card, title: 'Revenue 2026', html: '<strong>Updated</strong>' },
		)

		for (const patch of [
			{ title: '' },
			{ html: 12 },
			{ html: 'x'.repeat(200_001) },
			{ widget: 'kanban' },
			{ text: 'legacy' },
		]) {
			assert.throws(
				() => store.apply({ operations: [{ type: 'update', id: 'html-card', patch }] }),
				(error: unknown) => error instanceof OperationError && error.status === 400,
				JSON.stringify(patch),
			)
		}

		assert.throws(
			() =>
				store.apply({
					operations: [
						{
							type: 'create',
							shape: {
								id: 'legacy-widget',
								type: 'widget',
								x: 0,
								y: 0,
								w: 100,
								h: 100,
								color: '#5b5fc7',
								widget: 'todo',
								widgetTitle: 'Legacy',
								items: [],
							},
						},
					],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.throws(
			() =>
				store.apply({
					operations: [
						{
							type: 'create',
							shape: { ...card, id: 'missing-html', frameId: 'nope' },
						},
					],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.throws(
			() =>
				store.apply({
					operations: [
						{
							type: 'create',
							shape: {
								id: 'html-note',
								type: 'note',
								x: 40,
								y: 60,
								w: 80,
								h: 80,
								color: '#fef3c7',
								text: 'Nope',
								frameId: 'html-card',
							},
						},
					],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('legacy lines may keep an ignored text field', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	const store = new BoardStore(dbPath)
	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'legacy-line',
						type: 'line',
						x: 0,
						y: 0,
						w: 100,
						h: 40,
						color: '#123456',
						text: '',
					},
				},
			],
		})
		store.apply({
			operations: [{ type: 'update', id: 'legacy-line', patch: { text: 'ignored' } }],
		})
		store.close()
		const reopened = new BoardStore(dbPath)
		try {
			assert.deepEqual(reopened.getBoard().shapes[0], {
				id: 'legacy-line',
				type: 'line',
				x: 0,
				y: 0,
				w: 100,
				h: 40,
				color: '#123456',
				text: 'ignored',
			})
		} finally {
			reopened.close()
		}
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('frames connect only to frames', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		const left = {
			id: 'left',
			type: 'frame' as const,
			x: 0,
			y: 0,
			w: 400,
			h: 300,
			color: '#5b5fc7',
			title: 'Left',
		}
		const right = { ...left, id: 'right', x: 600, title: 'Right' }
		const node = {
			id: 'node',
			type: 'note' as const,
			x: 100,
			y: 100,
			w: 120,
			h: 120,
			color: '#fde68a',
			text: 'Inside',
			frameId: 'left',
		}
		store.apply({
			operations: [
				{ type: 'create', shape: left },
				{ type: 'create', shape: right },
				{ type: 'create', shape: node },
			],
		})
		const board = store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'frame-edge',
						type: 'connector',
						from: 'left',
						to: 'right',
						fromAnchor: 3,
						toAnchor: 5,
						color: '#5c6474',
					},
				},
			],
		})
		assert.ok(board.shapes.some((shape) => shape.id === 'frame-edge'))

		for (const operations of [
			[
				{
					type: 'create',
					shape: {
						id: 'mixed',
						type: 'connector',
						from: 'left',
						to: 'node',
						color: '#5c6474',
					},
				},
			],
			[{ type: 'update', id: 'frame-edge', patch: { to: 'node' } }],
			[{ type: 'update', id: 'frame-edge', patch: { from: 'node', to: 'right' } }],
		] as const) {
			assert.throws(
				() => store.apply({ operations: [...operations] }),
				(error: unknown) => error instanceof OperationError && error.status === 400,
				JSON.stringify(operations),
			)
		}
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('sticky note text updates persist', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	const store = new BoardStore(dbPath)
	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'note',
						type: 'note',
						x: 10,
						y: 10,
						w: 160,
						h: 160,
						color: '#fef3c7',
						text: 'Note',
					},
				},
			],
		})
		store.apply({ operations: [{ type: 'update', id: 'note', patch: { text: 'Remember this' } }] })
		store.close()
		const reopened = new BoardStore(dbPath)
		try {
			assert.deepEqual(reopened.getBoard().shapes, [
				{
					id: 'note',
					type: 'note',
					x: 10,
					y: 10,
					w: 160,
					h: 160,
					color: '#fef3c7',
					text: 'Remember this',
				},
			])
		} finally {
			reopened.close()
		}
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('legacy widget shapes and incompatible connectors are dropped on load', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	const store = new BoardStore(dbPath)
	const legacy = [
		{
			id: 'legacy-widget',
			type: 'widget',
			x: 0,
			y: 0,
			w: 100,
			h: 100,
			color: '#5b5fc7',
			widget: 'todo',
			widgetTitle: 'Legacy',
			items: [],
		},
		{
			id: 'kept',
			type: 'rectangle',
			x: 200,
			y: 0,
			w: 100,
			h: 100,
			color: '#5b5fc7',
		},
		{ id: 'legacy-edge', type: 'connector', from: 'kept', to: 'legacy-widget', color: '#5c6474' },
		{
			id: 'legacy-frame',
			type: 'frame',
			x: 500,
			y: 0,
			w: 300,
			h: 300,
			color: '#5b5fc7',
			title: 'Legacy frame',
		},
		{ id: 'mixed-edge', type: 'connector', from: 'legacy-frame', to: 'kept', color: '#5c6474' },
	]
	try {
		store.db
			.prepare("UPDATE canvases SET revision = ?, shapes = ? WHERE id = 'main'")
			.run(7, JSON.stringify(legacy))
		assert.deepEqual(
			store.getBoard().shapes.map((shape) => shape.id),
			['kept', 'legacy-frame'],
		)
		assert.equal(store.getBoard().revision, 7)
		const row = store.db.prepare("SELECT shapes FROM canvases WHERE id = 'main'").get() as {
			shapes: string
		}
		assert.deepEqual(
			(JSON.parse(row.shapes) as { id: string }[]).map((shape) => shape.id),
			['kept', 'legacy-frame'],
		)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('canvases are isolated, switchable and managed', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		const initial = store.getState()
		assert.equal(typeof initial.stateVersion, 'number')
		const initialVersion = initial.stateVersion
		assert.equal(initial.activeCanvasId, 'main')
		assert.equal(initial.canvases.length, 1)
		assert.equal(initial.canvases[0].name, 'My canvas')
		assert.match(initial.canvases[0].preview ?? '', /^data:image\/svg\+xml;base64,/)
		assert.ok(!Number.isNaN(Date.parse(initial.canvases[0].updatedAt)))

		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'main-shape',
						type: 'rectangle',
						x: 0,
						y: 0,
						w: 80,
						h: 40,
						color: '#123456',
					},
				},
			],
		})
		const mainPreview = store.getCanvasSummary('main').preview
		const created = store.createCanvas('Second canvas', true)
		const emptyPreview = created.canvas.preview
		assert.ok(created.state.stateVersion > initialVersion)
		assert.equal(created.state.activeCanvasId, created.canvas.id)
		assert.equal(created.canvas.name, 'Second canvas')
		assert.deepEqual(created.state.board, { revision: 0, shapes: [] })
		assert.deepEqual(
			store.getBoard('main').shapes.map((shape) => shape.id),
			['main-shape'],
		)

		const written = store.applyRequest({
			canvasId: created.canvas.id,
			operations: [
				{
					type: 'create',
					shape: { id: 'second-shape', type: 'note', x: 0, y: 0, w: 80, h: 80, color: '#fff8d4' },
				},
			],
		})
		assert.equal(written.canvasId, created.canvas.id)
		assert.equal(written.board.revision, 1)
		assert.equal(store.getActiveCanvasId(), created.canvas.id)
		assert.deepEqual(
			store.getBoard('main').shapes.map((shape) => shape.id),
			['main-shape'],
		)
		assert.deepEqual(
			store.getBoard(created.canvas.id).shapes.map((shape) => shape.id),
			['second-shape'],
		)
		assert.notEqual(store.getCanvasSummary(created.canvas.id).preview, emptyPreview)
		assert.equal(store.getCanvasSummary('main').preview, mainPreview)

		const renamed = store.renameCanvas(created.canvas.id, 'Renamed canvas')
		assert.equal(
			renamed.canvases.find((canvas) => canvas.id === created.canvas.id)?.name,
			'Renamed canvas',
		)
		assert.equal(renamed.activeCanvasId, created.canvas.id)
		const detail = store.getCanvas(created.canvas.id)
		assert.equal(detail.canvas.name, 'Renamed canvas')
		assert.equal(detail.board.revision, 1)

		const activated = store.activateCanvas('main')
		assert.ok(activated.stateVersion > renamed.stateVersion)
		assert.equal(activated.activeCanvasId, 'main')
		assert.equal(activated.board.revision, 1)
		assert.deepEqual(
			activated.board.shapes.map((shape) => shape.id),
			['main-shape'],
		)

		const deleted = store.deleteCanvas('main')
		assert.ok(deleted.stateVersion > activated.stateVersion)
		assert.equal(deleted.activeCanvasId, created.canvas.id)
		assert.deepEqual(
			deleted.canvases.map((canvas) => canvas.name),
			['Renamed canvas'],
		)
		assert.throws(
			() => store.deleteCanvas(created.canvas.id),
			(error: unknown) => error instanceof OperationError && error.code === 'LAST_CANVAS',
		)

		const fallback = store.createCanvas()
		assert.equal(fallback.canvas.name, 'Untitled canvas')
		assert.equal(fallback.state.activeCanvasId, created.canvas.id)
		assert.throws(
			() => store.apply({ canvasId: 'missing', operations: [] }),
			(error: unknown) => error instanceof OperationError && error.status === 404,
		)
		assert.throws(
			() => store.createCanvas('   '),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
		assert.throws(
			() => store.renameCanvas(created.canvas.id, 'x'.repeat(81)),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('a legacy single-board database migrates to a canvas', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	const legacy = new DatabaseSync(dbPath)
	legacy.exec(
		'CREATE TABLE board (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, shapes TEXT NOT NULL)',
	)
	legacy
		.prepare('INSERT INTO board (id, revision, shapes) VALUES (1, ?, ?)')
		.run(
			3,
			JSON.stringify([
				{ id: 'legacy-shape', type: 'rectangle', x: 10, y: 20, w: 100, h: 50, color: '#123456' },
			]),
		)
	legacy.close()

	const store = new BoardStore(dbPath)
	try {
		const state = store.getState()
		assert.equal(state.activeCanvasId, 'main')
		assert.equal(state.canvases.length, 1)
		assert.equal(state.canvases[0].name, 'My canvas')
		assert.equal(state.board.revision, 3)
		assert.deepEqual(
			state.board.shapes.map((shape) => shape.id),
			['legacy-shape'],
		)
		const old = store.db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'board'")
			.get()
		assert.equal(old, undefined)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('image assets and frame references persist and delete atomically', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-image-'))
	const dbPath = join(directory, 'board.sqlite')
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
	let store = new BoardStore(dbPath)
	try {
		const imageId = store.saveImage(png, 'image/png')
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'photo',
						type: 'image',
						x: 10,
						y: 20,
						w: 300,
						h: 200,
						color: '#123456',
						imageId,
					},
				},
				{
					type: 'create',
					shape: {
						id: 'hero',
						type: 'frame',
						x: 0,
						y: 0,
						w: 400,
						h: 300,
						color: '#123456',
						title: 'Hero',
						backgroundImageId: 'photo',
					},
				},
			],
		})
		const frame = store.getBoard().shapes.find((shape) => shape.id === 'hero')
		assert.ok(frame?.type === 'frame')
		assert.equal(frame.backgroundFit, 'cover')

		store.apply({
			operations: [{ type: 'update', id: 'hero', patch: { backgroundFit: 'contain' } }],
		})
		store.close()
		store = new BoardStore(dbPath)
		const reopenedFrame = store.getBoard().shapes.find((shape) => shape.id === 'hero')
		assert.ok(reopenedFrame?.type === 'frame')
		assert.equal(reopenedFrame.backgroundImageId, 'photo')
		assert.equal(reopenedFrame.backgroundFit, 'contain')
		assert.ok(
			store.getBoard().shapes.some((shape) => shape.type === 'image' && shape.id === 'photo'),
		)
		store.apply({
			operations: [{ type: 'update', id: 'hero', patch: { backgroundImageId: null } }],
		})
		assert.equal(
			store.getBoard().shapes.find((shape) => shape.id === 'hero')?.type === 'frame' ? 'ok' : 'bad',
			'ok',
		)

		assert.throws(
			() =>
				store.apply({
					operations: [
						{
							type: 'create',
							shape: {
								id: 'missing',
								type: 'image',
								x: 0,
								y: 0,
								w: 10,
								h: 10,
								color: '#123456',
								imageId: 'missing-asset',
							},
						},
					],
				}),
			(error: unknown) => error instanceof OperationError && error.code === 'MISSING_IMAGE_ASSET',
		)
		assert.throws(
			() =>
				store.apply({
					operations: [
						{
							type: 'create',
							shape: {
								id: 'bad-frame',
								type: 'frame',
								x: 0,
								y: 0,
								w: 10,
								h: 10,
								color: '#123456',
								title: 'Bad',
								backgroundImageId: 'missing-photo',
							},
						},
					],
				}),
			(error: unknown) => error instanceof OperationError && error.status === 400,
		)

		store.apply({
			operations: [{ type: 'update', id: 'hero', patch: { backgroundImageId: 'photo' } }],
		})
		store.apply({
			operations: [
				{ type: 'delete', id: 'photo' },
				{ type: 'delete', id: 'hero' },
			],
		})
		assert.deepEqual(store.getBoard().shapes, [])
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'photo-2',
						type: 'image',
						x: 0,
						y: 0,
						w: 10,
						h: 10,
						color: '#123456',
						imageId,
					},
				},
				{
					type: 'create',
					shape: {
						id: 'hero-2',
						type: 'frame',
						x: 0,
						y: 0,
						w: 20,
						h: 20,
						color: '#123456',
						title: 'Hero',
						backgroundImageId: 'photo-2',
					},
				},
			],
		})
		store.apply({ operations: [{ type: 'delete', id: 'photo-2' }] })
		const heroWithoutImage = store.getBoard().shapes.find((shape) => shape.id === 'hero-2')
		assert.ok(heroWithoutImage?.type === 'frame')
		assert.equal(heroWithoutImage.backgroundImageId, undefined)
		store.close()
		store = new BoardStore(dbPath)
		const asset = store.getImage(imageId)
		assert.ok(asset)
		assert.equal(asset.contentType, 'image/png')
		assert.deepEqual(Buffer.from(asset.bytes), Buffer.from(png))
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('delete and recreate image shape id does not preserve stale frame background', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-image-recreate-'))
	const dbPath = join(directory, 'board.sqlite')
	const store = new BoardStore(dbPath)
	try {
		const imageId = store.saveImage(
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			'image/png',
		)
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'photo',
						type: 'image',
						x: 0,
						y: 0,
						w: 100,
						h: 100,
						color: '#123456',
						imageId,
					},
				},
				{
					type: 'create',
					shape: {
						id: 'hero',
						type: 'frame',
						x: 0,
						y: 0,
						w: 200,
						h: 200,
						color: '#123456',
						title: 'Hero',
						backgroundImageId: 'photo',
						backgroundFit: 'stretch',
					},
				},
			],
		})

		store.apply({
			operations: [
				{ type: 'delete', id: 'photo' },
				{
					type: 'create',
					shape: {
						id: 'photo',
						type: 'image',
						x: 10,
						y: 10,
						w: 120,
						h: 80,
						color: '#123456',
						imageId,
					},
				},
			],
		})
		const frame = store.getBoard().shapes.find((shape) => shape.id === 'hero')
		assert.ok(frame?.type === 'frame')
		assert.equal(frame.backgroundImageId, undefined)
		assert.equal(frame.backgroundFit, 'stretch')
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('delete then explicitly reassign recreated image shape id restores frame background', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-image-reassign-'))
	const dbPath = join(directory, 'board.sqlite')
	const store = new BoardStore(dbPath)
	try {
		const imageId = store.saveImage(
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			'image/png',
		)
		store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'photo',
						type: 'image',
						x: 0,
						y: 0,
						w: 100,
						h: 100,
						color: '#123456',
						imageId,
					},
				},
				{
					type: 'create',
					shape: {
						id: 'hero',
						type: 'frame',
						x: 0,
						y: 0,
						w: 200,
						h: 200,
						color: '#123456',
						title: 'Hero',
						backgroundImageId: 'photo',
						backgroundFit: 'cover',
					},
				},
			],
		})

		store.apply({
			operations: [
				{ type: 'delete', id: 'photo' },
				{
					type: 'create',
					shape: {
						id: 'photo',
						type: 'image',
						x: 10,
						y: 10,
						w: 120,
						h: 80,
						color: '#123456',
						imageId,
					},
				},
				{
					type: 'update',
					id: 'hero',
					patch: { backgroundImageId: 'photo', backgroundFit: 'contain' },
				},
			],
		})
		const frame = store.getBoard().shapes.find((shape) => shape.id === 'hero')
		assert.ok(frame?.type === 'frame')
		assert.equal(frame.backgroundImageId, 'photo')
		assert.equal(frame.backgroundFit, 'contain')
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('active canvas and its content persist across reopen', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	const store = new BoardStore(dbPath)
	let canvasId = ''
	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'main-note', type: 'note', x: 0, y: 0, w: 80, h: 80, color: '#fff8d4' },
				},
			],
		})
		const created = store.createCanvas('Persisted canvas', true)
		canvasId = created.canvas.id
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'second-note', type: 'note', x: 10, y: 10, w: 80, h: 80, color: '#ffe9f0' },
				},
			],
		})
	} finally {
		store.close()
	}
	const reopened = new BoardStore(dbPath)
	try {
		const state = reopened.getState()
		assert.equal(state.activeCanvasId, canvasId)
		assert.equal(state.board.shapes[0].id, 'second-note')
		assert.deepEqual(state.canvases.map((canvas) => canvas.name).sort(), [
			'My canvas',
			'Persisted canvas',
		])
		assert.deepEqual(
			reopened.getBoard('main').shapes.map((shape) => shape.id),
			['main-note'],
		)
	} finally {
		reopened.close()
		rmSync(directory, { recursive: true, force: true })
	}
})
