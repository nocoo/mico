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

test('connector anchors validate types, ranges, endpoint changes, and atomic rollback', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	const store = new BoardStore(dbPath)
	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'a', type: 'rectangle', x: 0, y: 0, w: 100, h: 100, color: '#123456' },
				},
				{
					type: 'create',
					shape: { id: 'b', type: 'line', x: 200, y: 0, w: 100, h: 100, color: '#654321' },
				},
				{
					type: 'create',
					shape: { id: 'c', type: 'connector', from: 'a', to: 'b', color: '#abcdef' },
				},
			],
		})

		for (const invalid of [-1, 12, 1.5, '2', null, {}]) {
			assert.throws(() =>
				store.apply({
					operations: [
						{
							type: 'create',
							shape: {
								id: `invalid-${String(invalid)}`,
								type: 'connector',
								from: 'a',
								to: 'b',
								color: '#abcdef',
								fromAnchor: invalid,
							},
						},
					],
				}),
			)
		}

		assert.throws(() =>
			store.apply({
				operations: [{ type: 'update', id: 'c', patch: { toAnchor: 5 } }],
			}),
		)

		const before = store.getBoard()
		assert.throws(() =>
			store.apply({
				operations: [
					{ type: 'update', id: 'c', patch: { from: 'b', to: 'a', fromAnchor: 4, toAnchor: 2 } },
					{ type: 'update', id: 'c', patch: { to: 'c' } },
				],
			}),
		)
		assert.deepEqual(store.getBoard(), before)

		const changed = store.apply({
			operations: [
				{ type: 'update', id: 'c', patch: { from: 'b', to: 'a', fromAnchor: 4, toAnchor: 2 } },
			],
		})
		const connector = changed.shapes.find((shape) => shape.id === 'c')
		assert.deepEqual(connector, {
			id: 'c',
			type: 'connector',
			from: 'b',
			to: 'a',
			color: '#abcdef',
			fromAnchor: 4,
			toAnchor: 2,
		})
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
})

test('connector anchors persist and old automatic connectors remain valid', () => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-store-'))
	const dbPath = join(directory, 'board.sqlite')
	let store = new BoardStore(dbPath)
	try {
		store.apply({
			operations: [
				{
					type: 'create',
					shape: { id: 'a', type: 'rectangle', x: 0, y: 0, w: 100, h: 100, color: '#123456' },
				},
				{
					type: 'create',
					shape: { id: 'b', type: 'ellipse', x: 200, y: 0, w: 100, h: 100, color: '#654321' },
				},
				{
					type: 'create',
					shape: { id: 'c', type: 'connector', from: 'a', to: 'b', color: '#abcdef' },
				},
			],
		})
		const oldConnector = store.getBoard().shapes.find((shape) => shape.id === 'c')
		assert.ok(oldConnector)
		assert.ok(!Object.hasOwn(oldConnector, 'fromAnchor'))
		assert.ok(!Object.hasOwn(oldConnector, 'toAnchor'))

		store.apply({
			operations: [{ type: 'update', id: 'c', patch: { fromAnchor: 3, toAnchor: 11 } }],
		})
		store.close()
		store = new BoardStore(dbPath)
		assert.deepEqual(
			store.getBoard().shapes.find((shape) => shape.id === 'c'),
			{
				id: 'c',
				type: 'connector',
				from: 'a',
				to: 'b',
				color: '#abcdef',
				fromAnchor: 3,
				toAnchor: 11,
			},
		)
	} finally {
		store.close()
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
