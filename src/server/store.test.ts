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
