import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
		store.db.prepare('UPDATE board SET shapes = ? WHERE id = 1').run(
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
		assert.throws(() => new BoardStore(dbPath))
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
			.prepare('UPDATE board SET revision = ?, shapes = ? WHERE id = 1')
			.run(7, JSON.stringify(legacy))
		assert.deepEqual(
			store.getBoard().shapes.map((shape) => shape.id),
			['kept', 'legacy-frame'],
		)
		assert.equal(store.getBoard().revision, 7)
		const row = store.db.prepare('SELECT shapes FROM board WHERE id = 1').get() as {
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
