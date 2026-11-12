import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Board, CanvasShape, Shape } from '../shared/types.ts'
import { CanvasHistory } from '../web/canvas/history.ts'
import { BoardStore } from './store.ts'

const note = (id: string): CanvasShape => ({
	id,
	type: 'note',
	x: 10,
	y: 20,
	w: 200,
	h: 130,
	color: '#fff8d4',
})
const withStore = (run: (store: BoardStore) => void) => {
	const directory = mkdtempSync(join(tmpdir(), 'mico-history-'))
	const store = new BoardStore(join(directory, 'board.sqlite'))
	try {
		run(store)
	} finally {
		store.close()
		rmSync(directory, { recursive: true, force: true })
	}
}

function replay(store: BoardStore, history: CanvasHistory, direction: 'undo' | 'redo'): Board {
	const current = store.getBoard()
	const operations = history.plan(current, direction)
	assert.ok(operations)
	const next = store.apply({ operations, expectedRevision: current.revision })
	history.complete(direction)
	return next
}

test('history roundtrips deletion cascades, frame membership and stacking order atomically', () =>
	withStore((store) => {
		const shapes: Shape[] = [
			{ ...note('frame'), type: 'frame', title: 'Group' },
			{ ...note('a'), frameId: 'frame' },
			note('b'),
			{
				id: 'edge',
				type: 'connector',
				from: 'a',
				to: 'b',
				fromAnchor: 3,
				toAnchor: 9,
				color: '#00a2e1',
			},
		]
		const before = store.apply({ operations: shapes.map((shape) => ({ type: 'create', shape })) })
		const after = store.apply({
			operations: [
				{ type: 'delete', id: 'frame' },
				{ type: 'delete', id: 'a' },
			],
		})
		const history = new CanvasHistory()
		history.record(before, after)
		const undone = replay(store, history, 'undo')
		assert.deepEqual(undone.shapes, before.shapes)
		assert.equal(undone.revision, after.revision + 1)
		assert.deepEqual(replay(store, history, 'redo').shapes, after.shapes)
	}))

test('history restores absent optional fields without deleting surviving connectors', () =>
	withStore((store) => {
		const before = store.apply({
			operations: [
				{ type: 'create', shape: note('a') },
				{ type: 'create', shape: note('b') },
				{
					type: 'create',
					shape: { id: 'edge', type: 'connector', from: 'a', to: 'b', color: '#00a2e1' },
				},
			],
		})
		const after = store.apply({
			operations: [
				{ type: 'update', id: 'a', patch: { text: 'Edited' } },
				{ type: 'update', id: 'edge', patch: { fromAnchor: 3 } },
			],
		})
		const history = new CanvasHistory()
		history.record(before, after)
		assert.deepEqual(replay(store, history, 'undo').shapes, before.shapes)
		assert.deepEqual(replay(store, history, 'redo').shapes, after.shapes)
	}))

test('image undo restores frame backgrounds and enforces the five-image cap', () =>
	withStore((store) => {
		const imageId = store.saveImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png')
		const image: CanvasShape = { ...note('image'), type: 'image', imageId }
		const frame: CanvasShape = {
			...note('frame'),
			type: 'frame',
			title: 'Backdrop',
			backgroundImageId: 'image',
			backgroundFit: 'cover',
		}
		const before = store.apply({
			operations: [
				{ type: 'create', shape: image },
				{ type: 'create', shape: frame },
			],
		})
		const after = store.apply({ operations: [{ type: 'delete', id: 'image' }] })
		const history = new CanvasHistory()
		history.record(before, after)
		assert.deepEqual(replay(store, history, 'undo').shapes, before.shapes)
		assert.deepEqual(replay(store, history, 'redo').shapes, after.shapes)
		for (let index = 0; index < 5; index++)
			store.apply({ operations: [{ type: 'create', shape: { ...image, id: `other-${index}` } }] })
		const full = store.getBoard()
		assert.throws(() => replay(store, history, 'undo'), /more than 5 image/)
		assert.deepEqual(store.getBoard(), full)
		assert.equal(history.canUndo, true)
	}))

test('restore validates exact keys, revision, index, shapes and final references without partial writes', () =>
	withStore((store) => {
		const before = store.apply({ operations: [{ type: 'create', shape: note('a') }] })
		assert.throws(
			() => store.apply({ operations: [{ type: 'restore', shape: note('a'), index: 0 }] }),
			/expectedRevision/,
		)
		assert.throws(
			() =>
				store.apply({
					operations: [{ type: 'restore', shape: note('a'), index: 0 }],
					expectedRevision: 0,
				}),
			/revision/,
		)
		const invalid = [
			{ type: 'restore', shape: note('a'), index: -1 },
			{ type: 'restore', shape: note('a'), index: 0.5 },
			{ type: 'restore', shape: note('a'), index: 0, extra: true },
			{ type: 'restore', shape: { ...note('a'), color: 'bad' }, index: 0 },
			{ type: 'restore', shape: { ...note('a'), frameId: 'missing' }, index: 0 },
			{
				type: 'restore',
				shape: { id: 'edge', type: 'connector', from: 'a', to: 'missing', color: '#00a2e1' },
				index: 0,
			},
			{ type: 'restore', shape: { ...note('image'), type: 'image', imageId: 'missing' }, index: 0 },
		]
		for (const operation of invalid) {
			assert.throws(() =>
				store.apply({
					operations: [{ type: 'delete', id: 'a' }, operation],
					expectedRevision: before.revision,
				}),
			)
			assert.deepEqual(store.getBoard(), before)
		}
	}))
