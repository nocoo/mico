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

test('shape labels accept typography and rectangles, ellipses and lines accept stroke width', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		const created = store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'label-rect',
						type: 'rectangle',
						x: 10,
						y: 20,
						w: 180,
						h: 80,
						color: '#183153',
						fill: '#fef3c7',
						text: '1840—1842\n鸦片战争',
						font: 'serif',
						fontSize: 24,
						fontWeight: 700,
						strokeWidth: 8,
					},
				},
				{
					type: 'create',
					shape: {
						id: 'label-ellipse',
						type: 'ellipse',
						x: 220,
						y: 20,
						w: 120,
						h: 80,
						color: '#2563eb',
						text: 'English label',
						font: 'sans',
						fontSize: 16,
						fontWeight: 500,
						strokeWidth: 2.5,
					},
				},
				{
					type: 'create',
					shape: {
						id: 'custom-line',
						type: 'line',
						x: 10,
						y: 120,
						w: 100,
						h: 20,
						color: '#475569',
						strokeWidth: 8,
					},
				},
			],
		})
		assert.equal(created.shapes.length, 3)
		assert.deepEqual(created.shapes[0], {
			id: 'label-rect',
			type: 'rectangle',
			x: 10,
			y: 20,
			w: 180,
			h: 80,
			color: '#183153',
			fill: '#fef3c7',
			text: '1840—1842\n鸦片战争',
			font: 'serif',
			fontSize: 24,
			fontWeight: 700,
			strokeWidth: 8,
		})

		const updated = store.apply({
			operations: [
				{
					type: 'update',
					id: 'label-rect',
					patch: { fontSize: 32, fontWeight: 600, strokeWidth: 12.5 },
				},
				{ type: 'update', id: 'label-ellipse', patch: { strokeWidth: 64 } },
				{ type: 'update', id: 'custom-line', patch: { strokeWidth: 64 } },
			],
		})
		assert.deepEqual(updated.shapes[0], {
			...created.shapes[0],
			fontSize: 32,
			fontWeight: 600,
			strokeWidth: 12.5,
		})
		assert.equal(
			updated.shapes[1].type === 'ellipse' ? updated.shapes[1].strokeWidth : undefined,
			64,
		)
		assert.equal(updated.shapes[2].type === 'line' ? updated.shapes[2].strokeWidth : undefined, 64)

		const beforeInvalid = store.getBoard()
		for (const operations of [
			[
				{
					type: 'create',
					shape: {
						id: 'atomic-rect',
						type: 'rectangle',
						x: 1,
						y: 1,
						w: 10,
						h: 10,
						color: '#000000',
						strokeWidth: 7,
					},
				},
				{ type: 'update', id: 'label-ellipse', patch: { strokeWidth: 65 } },
			],
			[
				{
					type: 'create',
					shape: {
						id: 'invalid-rect',
						type: 'rectangle',
						x: 1,
						y: 1,
						w: 10,
						h: 10,
						color: '#000000',
						strokeWidth: 0,
					},
				},
			],
			[
				{
					type: 'create',
					shape: {
						id: 'invalid-ellipse',
						type: 'ellipse',
						x: 1,
						y: 1,
						w: 10,
						h: 10,
						color: '#000000',
						strokeWidth: 65,
					},
				},
			],
			[{ type: 'update', id: 'label-rect', patch: { strokeWidth: 65 } }],
			[{ type: 'update', id: 'label-ellipse', patch: { strokeWidth: 0 } }],
			[{ type: 'update', id: 'custom-line', patch: { strokeWidth: 65 } }],
			[{ type: 'update', id: 'custom-line', patch: { font: 'hand' } }],
			[{ type: 'update', id: 'label-ellipse', patch: { fontSize: 4 } }],
		] as const) {
			assert.throws(
				() => store.apply({ operations: [...operations] }),
				(error: unknown) => error instanceof OperationError && error.status === 400,
				JSON.stringify(operations),
			)
			assert.deepEqual(store.getBoard(), beforeInvalid)
		}
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('rectangle and ellipse fills persist atomically and are transparent or hex only', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		const created = store.apply({
			operations: [
				{
					type: 'create',
					shape: {
						id: 'filled',
						type: 'rectangle',
						x: 10,
						y: 20,
						w: 100,
						h: 80,
						color: '#183153',
						fill: '#fef3c7',
						text: 'Dark ink',
					},
				},
				{
					type: 'create',
					shape: {
						id: 'transparent',
						type: 'ellipse',
						x: 150,
						y: 20,
						w: 100,
						h: 80,
						color: '#2563eb',
						fill: null,
					},
				},
				{
					type: 'create',
					shape: {
						id: 'legacy',
						type: 'rectangle',
						x: 300,
						y: 20,
						w: 100,
						h: 80,
						color: '#107c10',
					},
				},
			],
		})
		assert.equal(created.revision, 1)
		assert.deepEqual(
			created.shapes.find((shape) => shape.id === 'filled'),
			{
				id: 'filled',
				type: 'rectangle',
				x: 10,
				y: 20,
				w: 100,
				h: 80,
				color: '#183153',
				fill: '#fef3c7',
				text: 'Dark ink',
			},
		)
		const transparent = created.shapes.find((shape) => shape.id === 'transparent')
		assert.equal(transparent?.type === 'ellipse' ? transparent.fill : undefined, null)
		const legacy = created.shapes.find((shape) => shape.id === 'legacy')
		assert.equal(legacy?.type === 'rectangle' ? legacy.fill : 'unexpected', undefined)

		const updated = store.apply({
			operations: [
				{ type: 'update', id: 'filled', patch: { fill: null } },
				{ type: 'update', id: 'transparent', patch: { fill: '#dbeafe' } },
			],
		})
		assert.equal(updated.revision, 2)
		const updatedFilled = updated.shapes.find((shape) => shape.id === 'filled')
		assert.equal(updatedFilled?.type === 'rectangle' ? updatedFilled.fill : undefined, null)
		const updatedTransparent = updated.shapes.find((shape) => shape.id === 'transparent')
		assert.equal(
			updatedTransparent?.type === 'ellipse' ? updatedTransparent.fill : undefined,
			'#dbeafe',
		)

		for (const operations of [
			[{ type: 'update', id: 'filled', patch: { fill: '#fff' } }],
			[{ type: 'update', id: 'filled', patch: { fill: 'transparent' } }],
			[
				{ type: 'update', id: 'filled', patch: { fill: '#ffffff' } },
				{ type: 'update', id: 'legacy', patch: { fill: '#notok0' } },
			],
			[
				{
					type: 'create',
					shape: {
						id: 'bad-fill-text',
						type: 'text',
						x: 0,
						y: 0,
						w: 100,
						h: 30,
						color: '#242424',
						text: 'No fill',
						fill: '#ffffff',
					},
				},
			],
		]) {
			assert.throws(
				() => store.apply({ operations: [...operations] }),
				(error: unknown) => error instanceof OperationError && error.status === 400,
			)
		}
		assert.equal(store.getBoard().revision, 2)
		assert.equal(store.getBoard().shapes.length, 3)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('widget shapes validate kind, title and bounded items', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	const widget = {
		id: 'board-widget',
		type: 'widget' as const,
		x: 40,
		y: 60,
		w: 520,
		h: 360,
		color: '#5b5fc7',
		widget: 'kanban' as const,
		widgetTitle: 'Delivery board',
		items: [
			{ id: 'item-1', title: 'Draft', status: 'todo' },
			{ id: 'item-2', title: 'Build', status: 'doing' },
		],
	}
	try {
		store.apply({ operations: [{ type: 'create', shape: widget }] })
		const updated = store.apply({
			operations: [
				{
					type: 'update',
					id: 'board-widget',
					patch: { items: [{ id: 'item-1', title: 'Draft', status: 'done', done: true }] },
				},
			],
		})
		assert.equal(updated.shapes.length, 1)

		for (const patch of [
			{ widget: 'spreadsheet' },
			{ widgetTitle: '' },
			{ items: [{ id: '', title: 'x' }] },
			{ items: [{ id: 'x', title: 3 }] },
			{ items: [{ id: 'x', title: 'ok', start: Number.NaN }] },
		]) {
			assert.throws(
				() => store.apply({ operations: [{ type: 'update', id: 'board-widget', patch }] }),
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
							shape: { ...widget, id: 'note', type: 'note', widget: undefined },
						},
					],
				}),
			(error: unknown) => error instanceof OperationError,
		)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})
